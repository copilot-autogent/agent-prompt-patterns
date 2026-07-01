---
title: "Verification Before Completion"
category: "task-design"
evidenceLevel: "strong"
summary: "Agents declare tasks 'done' after writing code, merging a PR, or starting a process — without confirming the outcome materialized. This creates silent failures: broken deploys, crashed processes, test suites that were never run, and PRs merged while CI was still pending. Before claiming success on any task with an observable side-effect, produce and inspect concrete evidence that the effect occurred."
relatedPatterns: ["side-effect-verification", "deploy-lag-verification", "sprint-completion-verification", "evidence-freshness-decay", "tool-error-triage"]
tags: ["reliability", "verification", "silent-failure", "task-completion", "evidence", "deployment", "testing"]
---

## Problem

An agent completes a sequence of steps — runs tests, merges a PR, starts a server — and posts a confident ✅ summary. The deploy pipeline is broken. The server crashed on startup. The tests ran against a stale binary. Nothing in the agent's output surface-area indicates a problem.

Three recurring failure signatures:

**Completion by assumption**: The agent infers success from the absence of visible errors rather than from positive evidence. "The command returned without error" is not the same as "the intended effect happened." A `merge` call that returns `200 OK` does not mean the PR was the correct SHA, CI was green, or the deploy pipeline fired.

**State lag**: Some effects are deferred. A merge triggers a CI build that takes minutes. An `npm install` finishes but a subsequent import fails because the lockfile and installed modules diverged. The agent moves on before the delayed effect resolves, then declares success based on a pre-resolution snapshot.

**Verification via the same broken path**: An agent "verifies" a deploy by calling the same tool that performed the deploy. If the tool has a bug, both the action and the verification inherit it. Verification must use an independent channel — an HTTP request, a log line, a process listing, a filesystem check — that doesn't share the failure mode with the original operation.

## Context

This pattern applies to any task where success means a *change in state observable outside the current tool call*:

- **Merging a PR** — did the merge actually execute, was CI clean before merge, and did the deploy pipeline fire after?
- **Starting a process or server** — is the process listed in `ps` output AND does it respond to a health probe?
- **Running tests** — what does the exit code and summary line say, not just "test runner exited"?
- **Applying configuration changes** (`npm install`, `pip install -r requirements.txt`) — does re-running the dependent command succeed?
- **Writing to a file, database, or memory store** — does a subsequent read return the expected content?

The pattern is most important for **irreversible or high-stakes operations**: a PR merge that triggers a production deploy, a configuration change that gates a downstream agent, or a scheduled-task update that silently changes behavior. For low-stakes idempotent reads, verification cost may exceed benefit — use judgment.

## Solution

**Before claiming a task complete, produce and inspect concrete evidence that the observable effect occurred.**

The evidence type must match the task type:

| Task type | Minimum verification |
|---|---|
| Deploy | HTTP GET of a live URL returns expected content/status; or `node fetch`/curl against the specific endpoint, not a browser (browser disk-cache can serve stale content for minutes post-merge) |
| Process start | Process listed in `ps`/status output AND responds to a health probe (`curl http://localhost:PORT/health`) |
| Test run | Exit code + summary line confirms pass count; not just "tests ran" or absence of visible errors; use `test:coverage` variant where available to surface unhandled rejections |
| GitHub merge | `mergeable_state === "clean"` before merge; `grep` for a key change in `dist/` after the build completes |
| Config change (`npm install`, `pip install`) | Re-run the dependent command (e.g., import the installed package) and confirm no install-time or import-time error |
| File/memory write | Read back the written value and compare |

**Require verification to use an independent channel.** The verification step must not share the failure mode with the action it verifies:

- Don't verify a `send_file` call by calling `send_file` again — check the recipient's inbox
- Don't verify a `git push` by re-running `git push` — run `git log origin/branch --oneline -1` and confirm the expected SHA appears
- Don't verify a deploy by re-calling the deploy tool — make an HTTP request to the live URL

**Distinguish CI-equivalent from developer-mode execution.** Some verification paths hide failures that would surface in production:
- `npm test` vs `npm run test:coverage` — coverage mode surfaces unhandled rejections; plain test often doesn't
- `get_status` GitHub API vs `mergeable_state` check — `get_status` returns "0 checks / pending" before CI starts, falsely appearing green; `mergeable_state === "clean"` requires CI to actually pass

**Prompt template for tasks with observable side-effects:**

```
After [operation X], verify it succeeded by [specific check using an independent channel].
Do not proceed to [next step] until [observable evidence] confirms success.
If verification fails, treat it as a hard failure — do not retry the original operation
until you understand why the verification failed.
```

**Anti-patterns to avoid:**

- ❌ `"PR merged ✅"` without waiting for Pages/CI build to complete
- ❌ `"Server started"` without a `curl` health check
- ❌ `"Tests passed"` inferred from lack of visible error output
- ❌ Browser-based deploy verification within 1–2 min of merge — CDN cache artifacts produce false-negative 404s; use `node fetch`/curl to bypass browser disk-cache
- ❌ `get_status` to gate a PR merge — query `mergeable_state` instead

## Evidence

Multiple incidents in an autonomous multi-agent production system provide direct evidence across task types.

**GitHub merge + deploy verification (factor-dashboard #115, June 2026):** 14 panels were stuck in "Loading…" in production for approximately one day. A served-HTML marker grep passed — the panel markup was present in the static HTML — while browser hydration failed silently because a `${base}` path prefix was missing from a dynamic import. Sprint completion summary claimed ✅. The deploy was live but broken. A browser render check (canvas count > 0, zero failed resource loads post-hydration) would have surfaced the failure. `node fetch` chunk-integrity check was 100% clean; the failure only appeared in the browser render path.

**Deploy-lag false-positive (shogi-srs #186, June 2026):** Browser-based verification ~50s post-merge saw 2 orphan chunk-404s and 3 console errors that persisted across tabs and a 90-second wait. This looked like a regression. A `node fetch` chunk-integrity check found all chunks were 200 and chunk hashes matched the current `index.html`. The 404s were from the browser disk-cache serving prior-build chunk references during CDN propagation. The correct verification tool (curl/node fetch) showed a clean deploy; the incorrect tool (browser) showed a phantom failure.

**CI state false-positive (get_status, multiple incidents):** `github-pull_request_read method=get_status` returns commit-level CI checks, which show "pending, 0 checks" when CI hasn't started yet. Agents using this call to gate merge decisions concluded "CI green" and merged immediately, before CI had a chance to fail. The correct check is `mergeable_state === "clean"` via `method=get`, which reflects the platform's own merge-readiness assessment.

**Test runner partial-success (multiple incidents, May–June 2026):** `npm test` produced exit code 0 with all tests visually passing. `npm run test:coverage` (the CI-equivalent variant) produced exit code 1 due to unhandled promise rejections. Five consecutive PRs failed CI despite "all tests passing" in local pre-push verification. After the rule was documented ("always use `test:coverage` before push"), zero recurrences.

## Tradeoffs

**Benefit**: Silent failures surface at the task boundary rather than compounding through downstream steps. Debugging time shifts from "why did everything downstream go wrong?" to "why did this specific step not produce its observable outcome?" The verification step names the expected outcome explicitly, making the task's success criterion visible to both the agent and any human reviewer.

**Cost**: Each verification step adds latency and consumes tool-call budget. In tight context-window sessions ([Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)), verification competes with productive work. The test: what is the expected cost of downstream confusion when this particular failure goes undetected? For high-stakes, irreversible, or pipeline-gating operations, verification cost is almost always worth it. For low-stakes idempotent reads or intermediate computations, skip it.

**Watch out for:**

- **Verification via the same broken path**: If the tool used to act has a bug, a verification step calling the same tool inherits the bug. Always use an independent channel.
- **Over-indexing on absence of errors**: No visible error output is not evidence of success — it may be evidence that errors are being swallowed. Require positive evidence: a specific process in `ps`, a specific string in the response body, a specific exit code.
- **Checking too early**: Some effects are deferred. A Pages deploy takes 60–120s after a merge. A `pip install` may succeed but an import check may fail if the virtual environment is not activated. Understand the expected lag before interpreting a negative verification result.
- **CDN cache artifacts masking true deploy state**: Browser-based verification within 1–2 minutes of a deploy can serve stale content from the browser disk-cache, producing phantom 404s or content mismatches unrelated to the actual deployed state. Use `node fetch`/curl for deploy verification; treat browser results within the first 2–3 minutes post-deploy as potentially contaminated.

## Related Patterns

- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the specific failure mode where tool return values are unreliable indicators of success; verification-before-completion is the broader task-level discipline, of which side-effect verification is the tool-call-level mechanism
- **[Deploy-Lag Verification](/agent-prompt-patterns/patterns/deploy-lag-verification)** — the specific application of this pattern to the merge→deploy transition; the two-step check (artifact rebuilt from the patched commit AND process restarted after that build) is required because merge and deploy are independent events
- **[Sprint Completion Verification](/agent-prompt-patterns/patterns/sprint-completion-verification)** — applies this pattern to sprint-agent completion claims specifically: prose summaries describe intent, not confirmed state; always verify artifact state via structured API queries before acknowledging completion
- **[Evidence Freshness Decay](/agent-prompt-patterns/patterns/evidence-freshness-decay)** — verification evidence has a shelf life; a health check that passed 10 minutes ago is weaker evidence than one that passed 10 seconds ago; plan verification timing accordingly
- **[Tool Error Triage](/agent-prompt-patterns/patterns/tool-error-triage)** — when verification fails, the failure itself must be triaged before retrying the original operation; a failed health check may mean the deploy failed OR the health endpoint is temporarily unavailable
