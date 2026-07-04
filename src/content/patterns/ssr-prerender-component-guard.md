---
title: "SSR Prerender Component Guard"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "In SSR/static-site frameworks where prerender is configured to continue on error, a component that accesses browser-only APIs (localStorage, window) throws during static prerender, silently omits the route's index.html from the build output, and makes the live route HTTP 404 — while CI exits 0 and reports 'build succeeded'. Gate every browser-only component on a boolean flag set in onMount and add a direct file-existence CI check."
relatedPatterns: ["client-rendered-deploy-verification", "verification-before-completion", "negative-test-coverage"]
tags: ["ssr", "prerender", "sveltekit", "svelte", "static-site", "browser-api", "onmount", "ci-guard", "silent-failure", "404", "tier:2-standard"]
---

## Problem

An agent adds a new component to a SvelteKit adapter-static (or Next.js / Astro) project. The component reads `localStorage`, accesses `window`, or initializes a Svelte store from browser-only state (e.g. `writable(localStorage.getItem('key'))`). All unit tests pass — they import the component as a pure module without rendering it, so the browser-only call never executes. The build also exits 0, because the prerender configuration is set to continue on error (SvelteKit: `handleHttpError: 'warn'`; other frameworks have equivalent settings) — this suppresses the throw as a warning rather than a hard error.

What silently happens: during the static prerender phase, the framework renders every prerendered route to HTML. The component throws (`store.subscribe is not a function`, `window is not defined`, etc.). The prerender logs a `[500] GET /` warning and **skips writing that route's `index.html`** to the output directory. No file, no 404 at the origin, no error in the CI summary.

Production then serves HTTP 404 for the route while CI reads `✅ Build succeeded`. `verify_deploy(url)` on the base URL returns 200 from the last-good build still cached at the CDN edge — producing a false "deploy verified" confirmation. The sprint self-reports success. The page is 404 in production.

Two additional masking layers compound the problem:

**Unit tests are structurally blind to SSR throws.** Pure-function tests import components and call exported functions; they never invoke the framework's SSR render path. The SSR throw only occurs when the framework renders the component to a string during the prerender walk.

**A naïve CI [5xx] guard false-positives on legitimate dynamic routes.** SvelteKit adapter-static legitimately emits `[500] GET /puzzle/[id]/` for every dynamic route that is not prerendered (these are served via the SPA fallback). A `grep -qE '\[5[0-9]{2}\] GET '` on the entire build log fails on every build — blocking every deploy permanently.

## Context

This pattern applies when:

- The project uses a static-site adapter with a build-time prerender phase: SvelteKit `adapter-static`, Next.js `output: 'export'`, Astro with prerendering enabled.
- The framework is configured to continue prerendering on error (SvelteKit: `handleHttpError: 'warn'` in `svelte.config.js`; Next.js: default behavior; Astro: `output: 'static'` with `build.format` settings) so that a single component throw does not abort the entire build.
- The component accesses browser-only APIs: `localStorage`, `sessionStorage`, `window`, `document`, `navigator`, or imports a library that accesses these at module initialization. Svelte stores themselves are SSR-safe — but a store whose *value* is initialized by reading `localStorage` (e.g. `const count = writable(localStorage.getItem('count'))`) will throw during SSR because `localStorage` is undefined in Node.js. The issue is not `store.subscribe` per se but the browser-only API call inside the store initialization or component code.

It does **not** apply to:
- Server-rendered routes (SSR with a server runtime) where the same APIs are expected to be unavailable and errors surface immediately.
- Client-only routes explicitly excluded from prerendering (e.g. SvelteKit `export const prerender = false`).
- Components that access browser APIs only inside event handlers, not at render time.

## Solution

### 1. Gate every browser-only component with an `onMount` flag

```svelte
<script>
  import { onMount } from 'svelte';
  import BrowserOnlyComponent from './BrowserOnlyComponent.svelte';

  let ready = false;
  onMount(() => { ready = true; });
</script>

{#if ready}
  <BrowserOnlyComponent />
{/if}
```

**Why this works:** `onMount` only runs in the browser; it never executes during SSR prerender. The `ready` flag starts `false`, so the framework renders nothing for this slot during prerender. No browser-only API is called; no throw occurs; `index.html` is emitted as expected.

**Rule of thumb:** Any component that reads `localStorage`, accesses `window` or `document`, or imports a library that accesses these APIs at module initialization time must be wrapped in an `{#if ready}` block on every prerendered route. Note that `{#if ready}` prevents the component from **rendering** during SSR, but does **not** prevent module-level side effects — if the component or an imported module reads `localStorage` at the top level (outside any function), the import itself throws during prerender. In that case the underlying code must be fixed to defer the access to `onMount`, not just wrapped in a render gate.

### 2. Add a direct file-existence CI check

Build exit code is not sufficient when the framework's continue-on-error prerender setting masks throws. Check that each prerendered route's `index.html` was actually written:

```bash
# In your CI workflow, after the build step — run on a CLEAN build output directory
# (ensure prior build artifacts are removed before the build, e.g. rm -rf build/).
# Adapt the output directory and route paths to your framework/config:
#   SvelteKit adapter-static: build/  (or .svelte-kit/output/prerendered/ before copy)
#   Next.js output:'export':  out/
#   Astro (adapter-static):   dist/
test -s build/index.html              # home route
test -s build/stats/index.html        # /stats route
test -s build/flagged/index.html      # /flagged route
# Add one line per statically prerendered route.
```

Each `test -s` call fails (exit non-zero) if the file is absent or empty — catching the silent omission that the continue-on-error setting hides. This check is fast, zero-dependency, and catches the exact failure mode that build-exit-code cannot.

**Important:** Run this check only after a clean build (output directory wiped before building). If stale artifacts from a prior build survive in the output directory, `test -s` can pass even when the current prerender skipped the route.

The output directory and route-to-file mapping differ by framework (SvelteKit: `build/<route>/index.html`; Next.js: `out/<route>.html` or `out/<route>/index.html` depending on `trailingSlash`; Astro: `dist/<route>/index.html`). Derive the path from your project's actual config rather than copying the example verbatim.

### 3. Scope any [5xx] log-grep guard narrowly

If you also want to grep the build log for prerender errors, scope the pattern to the specific prerendered entry routes — never to all routes:

```bash
# BAD: false-positives on every dynamic (non-prerendered) route
grep -qE '\[5[0-9]{2}\] GET ' build.log && echo "FAIL: prerender error"

# GOOD: scoped to the specific prerendered entry routes, including trailing slash variants.
# Replace /myapp/ and the route names with your actual base path and prerendered routes.
# The route name group is optional (matching `?`) intentionally — this covers both the home
# route (/myapp/ itself) and named sub-routes (/myapp/stats/, /myapp/flagged/).
if grep -qE '\[5[0-9]{2}\] GET /myapp/(stats|flagged)?\/?( |$)' build.log; then
  echo "FAIL: prerendered entry route threw during prerender" && exit 1
fi
```

SvelteKit adapter-static logs `[500] GET /puzzle/[id]/` for every parameterized route served via SPA fallback. These are expected and benign. A guard that matches them will block every deploy.

**Note on trailing slashes:** SvelteKit prerender log entries typically include a trailing slash (e.g. `[500] GET /myapp/stats/`). Include `\/?` before the end anchor in your guard regex so it matches both `/stats` and `/stats/`.

**Prefer `test -s` over log-grep.** The file-existence check (step 2) is simpler, more direct, and immune to this scoping problem. Use log-grep only as a supplementary diagnostic hint.

### 4. Add a render-level test for SSR safety

Unit tests cannot catch SSR throws. To reproduce the SSR throw, the test must render the component in a **Node.js (non-browser) environment** where `window`, `localStorage`, and `document` are undefined — the same environment the prerender phase runs in.

**Important:** `@testing-library/svelte` under `jsdom` or `happy-dom` does **not** reproduce SSR throws. Those test environments provide `window`, `document`, and `localStorage`, so browser-only API access succeeds. A passing test in jsdom is vacuously true for SSR safety. Use Vitest with `--environment node` and the framework's SSR render API:

```js
// Using Svelte's server-side render function in a plain Node.js environment.
// Svelte 5: import { render } from 'svelte/server';
// Svelte 4: const { html } = MyPageSSR.render({});  — run via vite-node with ssr:true,
//   e.g.: vitest --environment node with vite-node transforming .svelte via @sveltejs/vite-plugin-svelte
// Run with: vitest --environment node  (or set environment: 'node' in vitest.config.js)
// jsdom/happy-dom WILL NOT work — they provide window/document/localStorage,
// which makes browser-only API calls succeed and the test vacuously pass.
import { test, expect } from 'vitest';
// Svelte 5 import (tree-shaken, SSR-only path):
import { render } from 'svelte/server';
// For Svelte 4: with SvelteKit's vite-node SSR transform, the component's default export
// is already the SSR-compiled version in the node environment, so:
//   import MyPage from './MyPage.svelte';  // default export has .render() in Svelte 4 SSR
//   expect(() => MyPage.render({})).not.toThrow();
import MyPage from './MyPage.svelte';

test('renders without throwing in Node SSR environment', () => {
  // This runs in a plain Node.js environment without window/document/localStorage.
  // If the component calls a browser-only API at render time, it throws here —
  // exactly matching what the SvelteKit prerender walk does.
  // NOTE: if the component accesses browser-only APIs at *import* time (not render time),
  // the import itself above will throw — which is also a test failure, and also correct.
  expect(() => render(MyPage, { props: {} })).not.toThrow();
});
```

If your project doesn't expose a server render function directly, the lightest approach is a build-level integration test: run `vite build` in a subprocess and assert `test -s build/index.html` (adapt the path to your framework's output directory). This is slower but catches the actual prerender path without additional test dependencies.

> **Alternative when full SSR test setup is impractical:** enforce code review for any component added to a prerendered route and treat the file-existence CI check (step 2) as the safety net.

**Prompt template for adding a new component to a prerendered route:**

```
Before adding <ComponentName> to a prerendered route:

1. Does it access localStorage, window, document, navigator at render time
   (inside the component template or lifecycle functions)?
   YES → wrap in {#if ready} / onMount gate (see ssr-prerender-component-guard)
   NO  → safe to render directly

   Also check: does it or any imported library access these APIs at the TOP LEVEL
   of the module (outside any function)? If so, the {#if ready} gate is insufficient
   — the import itself will throw. Fix: move browser-only access inside onMount.

2. After adding: run `test -s build/index.html` (and each prerendered route's index.html)
   to confirm the route was not silently omitted by the continue-on-error prerender setting.

3. If adding a CI guard that greps build logs for [5xx], scope it to the specific
   prerendered entry routes only — not all routes.
```

## Diagnosis: recovering from a blank page

If a production route is returning HTTP 404 (or serving a blank page from the last-good build):

1. **Confirm the route didn't publish.** Fetch live `index.html` with a cache-bypassing request (requires Node ≥18 for native `fetch`; use `node-fetch` on older runtimes):
   ```bash
   node -e "
     fetch('https://example.github.io/myapp/?cb=' + Date.now())
       .then(r => console.log(r.status, r.url))
   "
   ```
   HTTP 404 is a strong signal that `index.html` was not written to the build output, though the same symptom can also arise from a misconfigured base path, publish directory, or CDN routing rule — always cross-reference with the CI build log to confirm the prerender throw is the root cause.

2. **Find the throwing component.** Check the Pages/CI build log for `[5xx] GET /` lines near the affected route. The stack trace that follows names the exact component and API call:
   ```
   [500] GET /
   Error: Cannot read properties of undefined (reading 'getItem')
     at UpcomingReviews.svelte:12
   ```

3. **Apply the gate.** Add `{#if ready}` around the component (or remove the integration until the SSR safety issue is resolved).

4. **Verify.** After the fix merges and the new build deploys, `test -s build/index.html` returns exit 0 and the route serves 200.

## Evidence

**shogi-srs #216 (2026-07-03):** PR #224 added `UpcomingReviews.svelte` without an `{#if ready}` gate. The component initialized a Svelte store by reading `localStorage` at module load, which threw (`Cannot read properties of undefined (reading 'getItem')` in the Node.js SSR environment) during prerender, and silently omitted `index.html`. The home page returned HTTP 404 for approximately 30 minutes. Fixed via `eae2df8` (gate added) and `fefa157` (integration removed until the component's SSR safety bug was fixed). The CI build had exited 0 throughout; `verify_deploy` returned 200 from the last-good CDN cache; the sprint self-reported success. The outage was discovered via direct HTTP check of the live route.

**shogi-srs #225 (2026-07-04):** A CI guard added as a remediation for #216 used `grep -qE '\[5[0-9]{2}\] GET '` on the entire build log. SvelteKit adapter-static legitimately logs hundreds of `[500] GET /puzzle/[id]/` lines for non-prerendered parameterized routes. The guard false-positived on every build and blocked its own deploy. Fixed via `69f43e3` by scoping the grep to `/shogi-srs/(stats|flagged)?` (the specific prerendered entry routes). The preferred fix for future projects is `test -s build/index.html`, which avoids the scoping problem entirely.

Both incidents occurred within 24 hours on the same production system (July 2026). Unit test coverage was 100% for the component's business logic in both cases; the SSR throw was structurally invisible to the test suite.

## Tradeoffs

**Benefit:** The `{#if ready}` gate is a two-line change that prevents an entire class of silent 404s. The `test -s build/index.html` CI check adds one line per prerendered route and catches what build exit codes cannot. Together they close the feedback gap between "build succeeded" and "route actually published."

**Cost:** Every new component that accesses browser-only APIs requires a developer to recognize the constraint and add the gate. The render-level test (step 4) requires `svelte/server` (Svelte 5) or the component's SSR build (Svelte 4) running in a `vitest --environment node` context — if SSR test infrastructure isn't already in the project, it adds setup cost. The `test -s` CI check has a maintenance cost: it is a hand-maintained route list and must be updated when new prerendered routes are added; a route added but not listed will not be covered by the check.

**The `{#if ready}` gate defers rendering to client-side hydration**, which means the component's content will not be in the SSR HTML and will not be indexed by crawlers. For most interactive components (charts, stores, localStorage-backed UI), this is the correct tradeoff. For content that must be crawlable, the underlying component needs to be made SSR-safe instead of gated.

**The continue-on-error prerender setting is the root enabler.** In SvelteKit, `handleHttpError: 'warn'` (rather than `'fail'`) allows the build to complete when a route throws during prerender. If the framework was configured to abort on prerender errors (`handleHttpError: 'fail'` / equivalent in other frameworks), the throw would produce a non-zero build exit code and CI would catch it directly. The tradeoff is that a single broken component would block the entire site from deploying. Most production projects accept the warn/continue setting for resilience; this pattern makes it safe to do so.

## Related Patterns

- **[Client-Rendered Deploy Verification](/agent-prompt-patterns/patterns/client-rendered-deploy-verification)** — the complementary post-deploy check: once a route publishes, verify that the JavaScript bundles are actually intact and rendering (not just that the HTML was served). This pattern prevents the silent omission *before* deploy; client-rendered-deploy-verification confirms correctness *after* deploy.
- **[Verification Before Completion](/agent-prompt-patterns/patterns/verification-before-completion)** — the general principle: before declaring a task done, produce positive evidence that the intended effect occurred. Applying `test -s build/index.html` is the specific application of this principle to prerendered SSR builds.
- **[Negative Test Coverage](/agent-prompt-patterns/patterns/negative-test-coverage)** — adding tests that assert error conditions don't occur; the render-level SSR safety test (step 4) is a negative test: it asserts the component does not throw during render, covering a failure mode that the positive unit tests structurally miss.
