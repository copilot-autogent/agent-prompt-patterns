---
title: "Uncertainty-Gated Irreversible Action"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Before executing any irreversible action (merge, delete, deploy, external POST), explicitly enumerate the 2–3 facts the action depends on, verify the highest-stakes assumption with a fresh tool call, and state a confidence level. Act at HIGH or MODERATE confidence. At LOW confidence, escalate or wrap the action in a reversible alternative."
relatedPatterns: ["bounded-autonomy", "side-effect-verification", "sprint-completion-verification", "dead-sprint-recovery", "evidence-freshness-decay", "graceful-capability-degradation"]
tags: ["safety", "autonomy", "irreversibility", "verification", "merge", "deploy", "gate", "confidence", "assumption-checking"]
---

## Problem

Agents confidently execute irreversible actions — merging a PR, deleting a branch, sending a webhook, deploying to production — based on information that was accurate seconds ago, inferred from incomplete signals, or cached from an earlier step. When the action executes and the world turns out to be different from what the agent assumed, the damage is already done.

Three recurring failure signatures:

**False-positive CI gate**: `get_status` returns `"pending, 0 checks"` because CI has not started yet. The agent reads this as green (no failures present) and merges. The PR was never validated against the test suite. The bug ships.

**Sprint over-claim**: A sprint agent posts `"✅ PR #62 merged and complete"` before verifying the merge executed. The merge tool call was cut off by a timeout. The downstream deploy never triggers. No human notices for 24 hours.

**Incomplete WIP merge**: A dead sprint's open PR is recovered and merged. The automated summary claimed all files were present; the diff was not read against the spec. The UI module was never wired into the entry point. Dead code ships.

Each failure shares a root cause: an irreversible action was taken against a signal that had not been freshly verified. The cost of the action made the error hard to undo. The agent had no structured pause point before executing.

## Context

This pattern applies at the decision boundary between analysis and irreversible execution. It is not a general verification pattern — it specifically targets the moment an agent is *about to do something that cannot be easily undone*.

**The pattern is triggered by action type, not task complexity.** A simple, one-file merge on a mature codebase still warrants the gate. A complex multi-file analysis with no external mutations does not.

The pattern is most critical when:

- The action modifies state outside the agent's working directory (version control, external APIs, infrastructure)
- Failure carries meaningful recovery cost (rollback requires coordination, human intervention, or data loss risk)
- The agent's most recent relevant observation is more than a few turns old (state may have changed)
- The action is the final step in a long pipeline where earlier assumptions compound

The pattern does **not** apply to reversible actions. Applying it universally creates gate fatigue — when every action requires a verification loop, agents slow down without safety benefit. The key discipline is classification accuracy: correctly identifying which actions are irreversible before applying the gate.

## Solution

**Before every irreversible action, run a three-step uncertainty gate.**

### Step 1: Classify the action

Determine whether the action is reversible or irreversible:

| Action | Reversibility | Gate? |
|---|---|---|
| Edit a file (local) | Easy undo | No |
| Open a draft PR | Close and delete branch — but triggers CI, previews, and notifications that cannot be recalled | No¹ |
| Post a comment | Edit or delete — but recipients receive the notification immediately | No¹ |
| Close an issue as won't-fix | Reopen trivially | No |
| Merge a PR | Revert commit (risky at scale) | **YES** |
| Deploy to production | Rollback possible but operationally costly | **YES** |
| Delete a branch | May be irrecoverable | **YES** |
| Send an external webhook or email | Not reversible | **YES** |
| Push to a protected branch | Revert requires coordination | **YES** |

¹ The *surface action* is reversible, but secondary effects (CI runs, email notifications, preview deploys, code exposure) may not be. If the secondary effects are the primary concern (e.g., triggering a CI run that consumes quota, or exposing a branch to external reviewers), apply the gate anyway. Use judgment based on what specifically cannot be recalled.

If the action is reversible: skip the gate and proceed.

If the action is irreversible: continue to Steps 2 and 3.

### Step 2: Enumerate and verify assumptions

Identify the 2–3 facts the action depends on. For each, determine the highest-stakes assumption — the one whose falseness would cause the most damage if the action proceeds — and make a **fresh tool call** to verify it. Do not rely on cached observations, earlier-turn return values, or inferred state.

**Examples by action type:**

*Merging a PR:*
1. CI checks are green → **Verify**: query `mergeable_state` from the PR object (must equal `"clean"`). `mergeable_state === "clean"` is the best available composite signal on GitHub — it synthesizes branch protection rules, required checks, and merge conflicts into a single field. For additional precision on critical merges, also query check-runs for the exact head SHA and confirm all required checks show `conclusion === "success"`. Do not use `get_status` alone, which returns `"pending, 0 checks"` when CI has not yet started.
2. PR is complete — all required files are present → **Verify**: call `get_diff` and scan against the issue spec
3. Target branch is correct → **Verify**: read `base.ref` from the PR object

After verifying, **record the head SHA** from Step 1 and pass it as `expectedHeadSha` to the merge call. If the branch was pushed between your verification and the merge, the platform will reject the merge rather than silently merging an unverified revision (TOCTOU protection).

*Deleting a branch:*
1. The branch has no open PRs depending on it → **Verify**: list open PRs filtered to head branch
2. All work from this branch has been merged → **Verify**: compare branch tip to main; check for unmerged commits
3. No other agent or workflow references this branch name → **Verify**: search recent CI logs or workflow runs

*Deploying to production:*
1. Tests pass for the exact artifact being deployed → **Verify**: read CI check-runs for the specific commit SHA being deployed — do not query "latest CI run on the branch" (the branch may have advanced since the artifact was built; bind verification to the same SHA passed to the deploy tool)
2. No active incident in progress → **Verify**: query status page or incident tracker
3. Rollback plan exists and is executable → **Verify**: confirm rollback ref or artifact version is available

*Sending an external webhook or email:*
1. Target address / endpoint is correct → **Verify**: re-read from config source, not from memory
2. Payload content is correct → **Verify**: inspect payload structure (field names and types) without logging raw values that may contain secrets or PII; if the system supports a dry-run or preview mode, use it; otherwise confirm the schema matches expectations against the API spec before sending
3. This action has not already been sent (idempotency) → **Verify**: query delivery log or check idempotency key. Under concurrency, a pre-flight idempotency check is not sufficient on its own — another agent can send between your check and your send. Use an atomic idempotency key passed *with* the send operation (e.g., `Idempotency-Key` header) to make duplicate-send detection reliable; treat the pre-flight check as a best-effort early exit, not a safety guarantee.

### Step 3: State confidence and decide

After verification, assign one of three confidence levels:

- **HIGH (verified)**: The highest-stakes assumption was confirmed by a fresh API call with an unambiguous result. Proceed with the action.
- **MODERATE (inferred)**: The assumption could not be directly verified, but strong proxies exist (e.g., tests passed locally, CI was green 5 minutes ago, no conflicting agent is known to be running). MODERATE confidence is acceptable for lower-cost irreversible actions where reverting is practical (e.g., merging a PR where a revert commit is straightforward). For high-cost irreversible actions — production deploys, permanent deletes, external notifications — require HIGH confidence or escalate.
- **LOW (assumed)**: The assumption cannot be verified at all, or the verification returned an ambiguous or potentially stale result. **Do not proceed.** Either escalate to a human or substitute a reversible alternative (draft PR instead of merge; request human to trigger delete; dry-run mode before deploy).

### Gate log format

Document the gate before executing the action. This creates an audit trail and forces explicit reasoning:

```
IRREVERSIBLE ACTION: merge PR #62
Assumptions:
  1. CI checks are green → VERIFIED (mergeable_state=clean, 3/3 checks passed)
  2. PR is complete (all files present) → VERIFIED (get_diff shows bounded-autonomy.md + index update)
  3. Target branch is main → VERIFIED (base=main confirmed from PR object)
Confidence: HIGH → proceeding with merge.
```

```
IRREVERSIBLE ACTION: delete branch feat/old-feature
Assumptions:
  1. No open PRs depend on this branch → VERIFIED (0 open PRs with head=feat/old-feature)
  2. All commits merged to main → UNVERIFIABLE (no tool available to compare tip to main in this context)
  3. No workflow references this branch name → NOT CHECKED
Confidence: LOW → escalating to user before proceeding.
```

### Reversibility wrappers

When confidence is LOW, prefer a reversible alternative over blocking the task entirely:

| Intended irreversible action | Reversible substitute |
|---|---|
| Merge PR | Open final review comment; request human to merge |
| Delete branch | Request human to delete directly, or open a tracking issue to defer deletion — do not rename in-place (branch renames are themselves external mutations that can break open PRs, CI config, and automation keyed to the original ref) |
| Deploy to production | Deploy to staging; request human confirmation for production |
| Send webhook/email | Write payload to a staging sink or dry-run endpoint; request human to trigger the production send |
| Push to protected branch | Open a PR targeting the protected branch instead |

The goal is not to prevent progress but to preserve optionality until confidence is sufficient.

## Examples

**Correct application — merge with gate:**

An agent is about to squash-merge a reviewed PR. It runs the gate:

1. Calls `github-pull_request_read(method="get")` — `mergeable_state` is `"clean"`. ✅
2. Calls `github-pull_request_read(method="get_diff")` — diff contains all files listed in the issue spec. ✅  
3. Reads `base.ref` from Step 1 response — `"main"`. ✅

Gate log: `Confidence: HIGH → proceeding with merge.`

The agent merges.

---

**Correct application — LOW confidence, escalation:**

An agent is recovering a dead sprint's PR. It attempts to verify CI status:

1. Calls `get_status` — returns `"pending, 0 checks"`. Ambiguous (CI may not have started, per the documented anti-pattern).
2. Cannot determine `mergeable_state === "clean"` because the API times out.
3. Second attempt returns the same ambiguous result.

Gate log: `Confidence: LOW → CI status is ambiguous (0 checks pending, anti-pattern documented). Not merging. Escalating to supervisor.`

The agent posts a comment describing the ambiguity instead of merging.

---

**Anti-pattern — gate skipped:**

An agent sees `"✅ 3 tests passing"` in a previous turn's output. It merges without re-querying. The tests were for a different branch. The actual PR branch has a failing check added after the tests were observed. The bug ships.

The correct behavior: make a fresh API call for `mergeable_state` immediately before the merge call, regardless of what earlier observations showed.

## Evidence

**Strong evidence — multiple documented instances:**

- **`get_status` / `mergeable_state` anti-pattern**: Documented in CONTEXT.md as a recurring failure. `get_status` returns `"pending, 0 checks"` when CI has not started, producing false-positive CI green signals. The patch (use `mergeable_state === "clean"`) addresses the symptom; this pattern addresses the underlying failure mode — acting on an unverified signal before an irreversible action.

- **Sprint over-claim**: Multiple sprint agents posted `"✅ merged"` summaries without verifying the merge call executed. The PR remained open. Documented in [Sprint Completion Verification](/agent-prompt-patterns/patterns/sprint-completion-verification) with a production incident where a PR stayed open 24 hours post-summary.

- **WIP merge in dead sprint recovery**: A sprint PR was recovered and merged despite the UI module never being wired into the entry point — the sprint summary over-claimed completion, and the diff was not read against the spec before merging. Documented in [Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery).

All three failures involved an irreversible action (merge) executed against an unverified or stale signal. All three were preventable by a one-step gate: a fresh API call before the action.

## Tradeoffs

**Benefit**: Catches the highest-cost class of agent errors — irreversible actions taken on false premises — with minimal overhead. A single API call (seconds) prevents hours or days of recovery work.

**Cost**: Every gated action requires one additional tool call. For high-frequency pipelines executing hundreds of actions per minute, this adds latency. At typical agent action frequencies (one irreversible action per task), the cost is negligible.

**Watch out for:**

- **Gate fatigue**: If the gate is applied to reversible actions too, agents slow down without safety benefit. Maintain classification accuracy — reversible actions do not need the gate.
- **Verification using the same tool that may have failed**: If the concern is that a tool returned stale data, call a different endpoint (e.g., verify a merge via the read API, not by re-calling the merge endpoint). Verification must use a distinct code path.
- **Confidence inflation**: MODERATE confidence requires strong proxies, not just absence of disconfirming evidence. "I didn't see any failing checks" is not a proxy for "CI is green." Only treat inferences as MODERATE if they come from recent, structurally-related evidence.
- **Cascading assumptions**: A gate log that lists three assumptions, verifies one, and infers the other two without noting the inference is a LOW-confidence gate masquerading as HIGH. Be honest about what was and was not verified.

## Related Patterns

- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — defines the taxonomy of self-decidable vs. escalatable decisions; Uncertainty-Gated Irreversible Action provides the operational gate for actions near the boundary where reversibility, not just decision scope, determines the safety margin
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — verifies that an action *produced the intended effect* after executing; the uncertainty gate runs *before* executing; together they bracket the action with pre- and post-verification
- **[Sprint Completion Verification](/agent-prompt-patterns/patterns/sprint-completion-verification)** — applies the gate specifically to the sprint lifecycle endpoint (merge, close, deploy); the broader principle here generalizes beyond sprint contexts
- **[Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery)** — the recovery procedure when a gated action is skipped or the gate fails; understanding recovery costs concretizes why the gate is worth the overhead
