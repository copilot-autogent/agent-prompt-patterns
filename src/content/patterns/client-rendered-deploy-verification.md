---
title: "Client-Rendered Deploy Verification"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "For Astro/SPA/client-rendered sites, HTTP-level checks (curl 200) and served-HTML marker-grep both produce false positives. Apply a two-layer verification protocol: Layer 1 (cache-bypassing node fetch + chunk-integrity check) is authoritative; Layer 2 (browser render after CDN propagation) detects hydration failures that Layer 1 cannot."
relatedPatterns: ["deploy-lag-verification", "side-effect-verification", "empirical-validation-loop", "sprint-completion-verification"]
tags: ["verification", "deployment", "client-rendering", "spa", "astro", "browser-render", "false-positive", "false-negative", "cdn", "hydration", "chunk-integrity"]
---

## Problem

An agent merges a fix to an Astro or SPA site, runs a quick health check, and declares the deploy live. Later, users report that interactive panels are stuck showing "Loading…" — the content never hydrated. Or: the agent runs a browser check within 60 seconds of merge and sees chunk-404 errors, concludes the build is broken, and reopens an incident that was never a regression.

Two opposite false-signal failure modes coexist in client-rendered deployments:

**False positives from marker-grep and HTTP 200:**
Static HTML shells for client-rendered sites ship panel markup — including component containers and placeholder text — regardless of whether client-side JavaScript successfully hydrates them. Grepping served HTML for a component title string returns a match even when all 14 interactive panels are stuck "Loading…". An HTTP 200 confirms the origin is reachable, not that JavaScript loaded, executed, and rendered data.

**False negatives from premature browser verification:**
CDN propagation for GitHub Pages and similar static hosts takes 60–120 seconds after merge. A browser verification run too soon serves `index.html` from the pre-merge CDN edge. That stale `index.html` references prior-build chunk hashes that no longer exist on the origin — producing chunk-404 errors in the browser's network log. The browser's own HTTP cache can compound this: once it has cached the stale `index.html` (with `max-age`), even "fresh" tabs in the same browser session load the orphan-chunk references for the TTL. The deploy may be perfectly healthy while every browser check screams 404.

Both failure modes share a root cause: they check the wrong layer. The authoritative question is not "does the HTML exist?" or "do chunks 404 in my browser?" — it is "do the chunks referenced by the *current live* HTML all return 200 from a cache-bypassing fetch?"

## Context

This pattern applies when:

- The target site uses a client-side rendering framework: Astro (with `define:vars` or client hydration), Next.js, SvelteKit, Nuxt, or any SPA that ships a static HTML shell with JavaScript-populated content.
- The deployment platform uses a CDN with propagation delay (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
- The agent needs to confirm that a merged change is live *and working*, not merely that the HTML is served.
- The agent is investigating unexpected 404 errors after a recent merge and needs to determine whether they represent real regressions or cache artifacts.

It does **not** apply to:
- Server-rendered sites where HTML is fully rendered server-side (content visible in raw HTML curl).
- API endpoints where the response body is the artifact.
- Deployments with an authoritative rollout-complete signal from the CI/CD pipeline that can be polled directly.

## Solution

Apply a two-layer verification protocol. Layer 1 is always required and is authoritative. Layer 2 is run after Layer 1 passes and detects hydration failures that HTTP-level checks cannot see.

### Layer 1 — Cache-bypassing chunk integrity (authoritative)

**Run this first. It is the ground truth for deploy artifact health.**

```js
// node -e or equivalent — no browser, no cache
const url = 'https://example.github.io/my-app/';
const html = await fetch(url + '?cb=' + Date.now(), { cache: 'no-store' })
  .then(r => r.text());

// Extract all chunk references (adjust pattern to your bundler's output)
const chunkRefs = [...html.matchAll(/\/_app\/immutable\/[^\s"']+\.js/g)]
  .map(m => m[0]);

for (const ref of chunkRefs) {
  const res = await fetch('https://example.github.io' + ref, { method: 'HEAD', cache: 'no-store' });
  console.log(res.status, ref);
}
// All must be 200. Any 404 here is a real regression, not a cache artifact.
```

**Interpreting results:**

| Chunk status | Meaning |
|---|---|
| All 200 | Deploy artifact is intact. HTTP layer is correct. |
| Any 404 | The referenced chunk is missing from the origin. Real regression. |

If a 404 appears and you suspect a stale browser cache artifact rather than a regression, compare: does the 404 chunk hash appear anywhere in the current HTML (just fetched above) or in the current runtime JS bundles? If it does **not** appear in either → it is a prior-build leftover cached in the browser, not a production regression. Layer 1 already confirmed origin health; the browser error is a local artifact.

### Layer 2 — Browser render verification (run after Layer 1 passes)

**Wait ≥ 90 seconds after merge before running browser verification.** This allows CDN propagation to complete before a headless browser fetches `index.html`.

Using Playwright or equivalent:

```js
// After >= 90s post-merge delay
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });

// Check 1: interactive content rendered (not stuck "Loading…")
const loadingCount = await page.locator('text=Loading…').count();
assert(loadingCount === 0, `${loadingCount} panels still showing "Loading…"`);

// Check 2: canvas or content elements present
const contentCount = await page.locator('canvas, .panel-content').count();
assert(contentCount > 0, 'No rendered content found');

// Check 3: no 404s in network log post-hydration
const failed = [];
page.on('requestfailed', req => failed.push(req.url()));
page.on('response', res => { if (res.status() >= 400) failed.push(res.url()); });
assert(failed.length === 0, `Failed resources: ${failed.join(', ')}`);
```

**Anti-patterns to avoid:**

- **Marker-grep on served static HTML.** Grep matching a component's title in raw HTML does not confirm hydration. Static HTML ships the markup shell regardless of runtime success.

- **Running browser verification within 60s of merge.** CDN propagation is not instantaneous. Early browser checks can cache stale chunk references for the full `max-age` TTL, blocking correct verification across all tabs for 10+ minutes.

- **Treating browser chunk-404s as authoritative before running Layer 1.** Always run the cache-bypassing node-fetch check first. Browser errors frequently reflect the browser's own HTTP cache, not origin state. Layer 1 is the authoritative artifact check; browser errors are secondary evidence.

- **Checking only HTTP status of the HTML page.** A 200 on `index.html` means the CDN edge is reachable. It does not mean the JavaScript bundles for the *current build* exist at the origin.

**Decision tree:**

```
Did Layer 1 chunk-integrity check pass?
├── NO  → Real regression. Debug the build/deploy pipeline.
└── YES → Wait >= 90s total since merge, then run Layer 2.
           ├── Layer 2 passes → Deploy confirmed live and rendering.
           └── Layer 2 shows 404s:
               └── Do the 404 chunk hashes appear in current HTML or bundles?
                   ├── YES → Real regression (deploy broke bundle references).
                   └── NO  → Stale browser cache artifact. Layer 1 is correct.
                              Clear browser cache and re-verify, or use incognito.
```

**Prompt template:**

```
Verify deploy of [site URL] after merge of [PR #N]:

Layer 1 (authoritative — run first):
1. node -fetch with ?cb=Date.now() + cache:'no-store' on [site URL]
2. Extract _app/immutable/*.js chunk refs from returned HTML
3. HEAD each chunk with cache:'no-store' — all must return 200
→ If any 404: real regression, stop, investigate pipeline
→ If all 200: continue to Layer 2

Layer 2 (browser render — wait >= 90s post-merge):
1. Playwright render to networkidle
2. Assert: zero "Loading…" in rendered DOM
3. Assert: content/canvas elements > 0
4. Assert: zero 404s in network log post-hydration
→ If 404s appear: cross-reference chunk hashes against current HTML refs
  → Hash not in current HTML = prior-build browser cache artifact (not a regression)
  → Hash in current HTML = real regression

Do NOT declare deploy confirmed until both layers pass.
```

## Evidence

**factor-dashboard #115 (2026-06-30):** A dynamic-import statement was missing the `${base}` path prefix. All 14 interactive panels shipped HTML markup and a "Loading…" placeholder — static HTML marker-grep matched every panel. Browser render revealed all panels stuck "Loading…". The missing `${base}` caused a runtime dynamic-import 404 that marker-grep was structurally incapable of detecting. Panels were silently broken in production for approximately one day before the hydration-level check surfaced the root cause.

**shogi-srs #186 (2026-06-30):** Browser verification was run approximately 50 seconds after merge. The browser served a stale `index.html` from CDN cache that referenced two prior-build chunk hashes. Those hashes produced 404 errors in the browser network log and triggered three console errors that persisted across new tabs for 90 seconds — consistent with `max-age` TTL. A cache-bypassing `node fetch` chunk-integrity check returned 200 for all current-build chunks. The deploy was healthy; the browser errors were prior-build cache artifacts. Without Layer 1 as the authoritative check, the agent would have incorrectly reopened a resolved incident.

Both incidents are from production agentic CI/CD systems (June 2026). Together they demonstrate both failure directions: one where HTTP/grep checks produce false positives (factor-dashboard), one where premature browser checks produce false negatives (shogi-srs). The two-layer protocol resolves both.

## Tradeoffs

**Benefit:** Eliminates two systematic false-signal failure modes simultaneously. Layer 1 provides a 15-second, no-browser-required authoritative check that is immune to CDN cache timing. Layer 2 provides the only check that can detect hydration failures, but only after Layer 1 rules out artifact-level regressions.

**Cost:** Layer 1 requires parsing chunk references from HTML — the exact pattern depends on the bundler (`_app/immutable/*.js` for SvelteKit/Astro, `static/js/*.chunk.js` for CRA, `_next/static/*.js` for Next.js). Update the extraction regex to match your build output. Layer 2 requires a headless browser environment.

**When to skip Layer 2:** If the site is entirely server-rendered (content visible in raw HTML), Layer 1 alone is sufficient. Layer 2 is only necessary when JavaScript must execute to produce visible content.

**When to skip this pattern entirely:** Platforms that provide a first-party rollout-complete signal (Vercel `readyState: READY`, Cloudflare Pages deployment-complete webhook, Netlify `state: ready`) can substitute that signal for Layer 1. Still run Layer 2 if hydration correctness matters.

## Related Patterns

- **[Deploy-Lag Verification](/agent-prompt-patterns/patterns/deploy-lag-verification)** — verifies that a fix has been deployed at all (artifact built from patched commit, process restarted); client-rendered deploy verification is the complementary check for *what the deployed artifact actually renders*, not whether it is the right artifact
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the general principle: verify observable outcomes rather than trusting return values or status codes; this pattern is the client-rendering-specific application
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — treat post-deploy observations as measurements requiring the correct instrument; grepping HTML is the wrong instrument for hydration correctness
- **[Sprint Completion Verification](/agent-prompt-patterns/patterns/sprint-completion-verification)** — after a sprint reports "deploy verified", apply this pattern as the backstop: a sprint summary can over-claim verification using only marker-grep
