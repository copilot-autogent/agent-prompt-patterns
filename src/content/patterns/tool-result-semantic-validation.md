---
title: "Tool Result Semantic Validation"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "When a tool call succeeds (status 200, no exception), validate the semantic content of the result before trusting it — a success code is not proof of a valid result. Empty bodies, stale builds, and wrong-context status codes all arrive as 'success'; without semantic validation, agents produce plausibly-wrong output with no error signal."
relatedPatterns: ["tool-error-triage", "graceful-capability-degradation", "verification-before-completion", "client-rendered-deploy-verification", "deploy-lag-verification", "evidence-freshness-decay"]
tags: ["validation", "tool-calls", "semantic-failure", "empty-response", "false-positive", "feedback-loops", "fallback", "web-fetch", "deploy-verification", "ci-status"]
---

## Problem

An agent calls a critical tool, receives a non-error response, and trusts the result without inspecting its content. The tool returned `200 OK` — but the output is empty, stale, or semantically invalid. The agent proceeds to produce wrong outputs or take wrong actions, with no error signal to investigate.

A success status code proves the transport succeeded. It proves nothing about the content.

**Three documented silent-failure modes:**

**Empty body on 200 (`web_fetch` / HTTP)**  
`web_fetch` returns HTTP 200 with a blank body behind certain CDN configurations. The same URL returns full content via a direct `node https` request with a proper `User-Agent`. An agent that treats empty body as "no results found" produces a confident "📭 no posts" output when dozens of posts exist. This is indistinguishable at the status-code level from a legitimately empty response.

**Stale-build response (deploy verification)**  
`verify_deploy` returns HTTP 200 because the prior build is still being served. The new build never published — the deploy silently stalled — but the agent reads the 200 as "deploy live" and closes the issue. Meanwhile, users see the old version. The agent's self-reported "✅ deploy verified" is wrong in the worst way: confidently wrong, with no failure signal to act on.

**Wrong-context status (CI status API)**  
`github-pull_request_read method=get_status` returns "pending, 0 checks" when CI checks haven't been *scheduled* yet — not because they passed. This is semantically invalid for the question "is CI green?" but it's not a tool error. An agent that maps "0 checks" to "nothing failed" merges the PR before CI has even started.

In every case: the tool reports success, the agent trusts it, and the output is plausibly-wrong with no error/fail signal. The errors surface downstream — wrong blog digest, stale deploy, CI broken post-merge — when they're expensive to trace back.

## Context

This pattern applies whenever:

- The agent makes tool calls whose results determine a downstream decision (merge/don't merge, deploy/report-failure, publish/skip)
- The tool's result can be "empty" or "minimal" for *either* a valid reason (nothing to report) *or* a failure reason (tool silently failed)
- Multiple sources are queried in parallel, making all-empty plausible but implausible from a domain perspective

It does *not* apply to tool calls where empty is the only valid outcome (e.g., a write operation that returns no body by design, or a search over a domain known to be empty).

The pattern is specifically about the gap between [`tool-error-triage`](/agent-prompt-patterns/patterns/tool-error-triage) (which handles explicit errors) and trusting success responses — the zone where the tool says "OK" but the content is not.

## Solution

For every critical tool call, define what "semantically valid" output looks like *before* calling it, then validate that condition on the response.

### Step 1 — Define validity invariants upfront

Before calling the tool, state the invariant the result must satisfy to be trusted. Examples:

| Tool call | Validity invariant |
|---|---|
| `web_fetch` to fetch a blog/news page | Body is non-empty AND contains at least one expected structural element (e.g., post title, article tag) |
| `verify_deploy` for a new release | HTTP 200 AND `last-modified` header is later than the merge timestamp |
| `get_status` for CI readiness | `mergeable_state === "clean"` (not `"pending"` or `"unstable"`) |
| Any multi-source query | At least one source returns non-empty content (all-empty = outage signal) |
| File contents fetch | Returned content matches expected size/key structure (not truncated, not placeholder) |

### Step 2 — Validate content, not just status

After a successful call, assert the invariant. If it fails, treat the call as a *semantic failure* — as distinct as a 500 error — and take the same failure path.

```
result = web_fetch(url)

if result.ok and is_empty(result.body):
  # Do NOT conclude "nothing found"
  log_semantic_failure(f"web_fetch returned 200 but empty body: {url}")
  raise SemanticFailure("empty-body-on-200")

# Only reach here if result is semantically valid
process(result.body)
```

**Empty is not "nothing found."** A valid empty response (a domain with no entries today) is almost always distinguishable from a transport-empty one — the page structure is absent entirely, not "present but listing zero items."

### Step 3 — All-empty = outage signal, not quiet day

When querying multiple sources and all return empty:

- This is a fetch-outage signal, not evidence the domain is empty.
- Do not publish a "nothing found today" report.
- Fall back to an alternative tool (e.g., `node https` with a full User-Agent when `web_fetch` returns empty) before concluding.
- If the alternative also fails, report the failure explicitly: "Unable to verify — all fetch attempts returned empty. Please check manually."

```
results = [web_fetch(url) for url in sources]
non_empty = [r for r in results if not is_empty(r.body)]

if len(non_empty) == 0:
  # All sources empty: outage red flag
  fallback_results = [node_https_fetch(url) for url in sources]
  if all(is_empty(r) for r in fallback_results):
    raise SemanticFailure("all-sources-empty — fetch outage suspected")
  results = fallback_results
```

### Step 4 — Log semantic failures as first-class errors

Semantic failures should produce a distinct, actionable log entry — not a quiet empty result that propagates silently through downstream processing.

A semantic failure log should state:
1. Which tool call produced the invalid result
2. What invariant was violated (empty body, stale timestamp, unexpected shape)
3. What fallback was attempted
4. Whether the fallback succeeded or whether manual intervention is needed

Treat "result ok but content invalid" the same as "result error" for alerting and retry/fallback decisions.

### Decision rule

```
if result.ok AND invariant_holds(result):
    trust_and_proceed()
elif result.ok AND NOT invariant_holds(result):
    log_semantic_failure()
    attempt_fallback()  # or escalate if no fallback
elif NOT result.ok:
    # standard tool-error-triage path
    classify_and_recover()
```

The middle branch — `result.ok AND NOT invariant_holds` — is the gap this pattern fills.

## Evidence

**`web_fetch` empty-body false-negative (autogent #826, 2026-07-06)**  
`web_fetch` returned HTTP 200 with empty body on multiple blog/news URLs behind a CDN. The same URLs returned full content via `node -e 'require("https").get(url, {headers: {"User-Agent": "Mozilla/5.0"}}, ...)'`. Three consecutive blog-digest runs on 2026-07-06/07/08 reported "📭 no posts found" while Simon Willison had 5+ posts on 07-07. The root cause was not "no posts" — it was a silent fetch failure that returned success. The blog-digest and academic-survey prompts were hardened with an all-sources-empty guard after this incident.

**Deploy verification false-positive (multiple incidents, 2026-06 to 2026-07)**  
`verify_deploy(url)` returns HTTP 200 from the prior cached build during CDN propagation, while the actual merged commit never published. Multiple sprint agents self-reported "✅ deploy verified" on stale builds. The fix: check that the live `index.html`'s `last-modified` header is *later than the merge timestamp* before concluding the deploy is live. HTTP status alone is insufficient.

**CI status false-positive (CONTEXT.md gotcha)**  
`github-pull_request_read method=get_status` returns "pending, 0 checks" when CI has not been scheduled yet — indistinguishable from a passing state using status code alone. Agents that mapped this to "no failures → green" merged PRs before CI ran. The fix: use `method=get` and check `mergeable_state === "clean"` instead. `"clean"` is the only state that means truly ready to merge.

**Evidence level: strong** — three independent documented failures across different tools, projects, and time periods. Each failure had the same structural cause (status-code trust without semantic validation) and each was fixed by adding the semantic check this pattern prescribes.

## Tradeoffs

**Benefit**: Silent failures surface immediately, with a specific error message pointing to the exact tool and invariant violation. Downstream decisions (publish, merge, close) are blocked until the result is confirmed semantically valid.

**Cost**: Every critical tool call needs an explicit invariant definition. This is upfront specification work. For novel tool calls, the "right" invariant may not be obvious until the first false-positive or false-negative is observed — the pattern doesn't eliminate all semantic failures, it systematizes how they're caught and handled once the invariant is known.

**Watch out for**:

- **Over-specifying invariants**: Invariants that are too tight (e.g., "response must contain exactly 12 items") will false-fail on valid variation. Invariants should capture *structural validity* (non-empty, expected keys present, timestamp in range) not *content specificity*.
- **Domain-empty vs transport-empty**: Some domains legitimately return empty (no open PRs today, no new releases). The invariant must reflect the domain context. A task that asks "are there any open PRs?" and gets an empty list back is a valid empty — not a semantic failure. Only validate against "empty" when the domain strongly implies non-empty results.
- **Stale-build vs slow-build**: During CDN propagation (first 60–120s after merge), a `last-modified` check may still show the prior build even on a successful deploy. Don't validate too eagerly. [`deploy-lag-verification`](/agent-prompt-patterns/patterns/deploy-lag-verification) covers the timing dimension; this pattern covers the structural dimension.
- **Fallback loops**: The fallback chain (primary tool → alternative tool → escalate) must be bounded. Cap at one fallback before escalating. An uncapped fallback loop re-introduces the same infinite-retry risk this pattern is trying to prevent.

## Related Patterns

- **[Tool Error Triage](/agent-prompt-patterns/patterns/tool-error-triage)** — classifies explicit tool *errors* (non-200, exceptions); this pattern fills the gap for *success* responses that are semantically invalid. The two patterns together cover the full tool-call reliability surface.
- **[Graceful Capability Degradation](/agent-prompt-patterns/patterns/graceful-capability-degradation)** — what to offer the user when a capability is unavailable; this pattern is upstream of that: it detects when a capability silently returned bad data rather than explicitly failing.
- **[Verification Before Completion](/agent-prompt-patterns/patterns/verification-before-completion)** — verifying that work is done; this pattern addresses a specific sub-problem: verifying that tool *outputs* are valid before using them to conclude work is done.
- **[Client-Rendered Deploy Verification](/agent-prompt-patterns/patterns/client-rendered-deploy-verification)** — browser-level deploy verification for SPAs; this is the specific deploy-verification procedure that this pattern's "stale-build" invariant check motivates.
- **[Deploy Lag Verification](/agent-prompt-patterns/patterns/deploy-lag-verification)** — timing-aware deploy checks accounting for CDN propagation; this pattern focuses on structural validity, deploy-lag covers the timing dimension.
- **[Evidence Freshness Decay](/agent-prompt-patterns/patterns/evidence-freshness-decay)** — stale evidence should be downweighted over time; this pattern addresses a related but distinct problem: tools that report success but return content that was fresh at one time and is now stale, with no explicit staleness signal.
