---
title: "Max-Retry Pivot"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "A single agent retrying the same failed approach wastes budget without making progress. After N failed attempts with the same approach class (default: 2), the agent must stop, explicitly articulate what is different about the next strategy, and either pivot or escalate — never silently attempt N+1 with identical logic."
relatedPatterns: ["convergence-stall-detection", "constraint-falsification", "hypothesis-before-action", "operator-blocked-escalation-ladder"]
tags: ["autonomy", "error-recovery", "retry", "pivot", "escalation", "strategy-switching", "loop-prevention", "debugging"]
---

## Problem

A single agent hits a failure, retries the same approach, hits the same failure again, and retries once more — consuming tokens, time, and sprint budget while producing nothing. The failure is not insufficient effort; it is absent strategy switching. Each retry is logically identical to the previous one: same tool, same data, same assumption about the root cause. The agent is not learning from the failure; it is repeating it.

This is qualitatively different from multi-agent convergence stall (many agents agreeing on a wrong answer). Here, **a single agent is trapped in a loop where each attempt is structurally identical to the previous one**, just re-executed with minor textual variation.

**Observed instances:**

- The autogent `when-debugging` playbook trigger is codified as "A fix doesn't work after 2 attempts → MUST load section." The 2-attempt rule was derived from observed sprint retry loops — a threshold that emerged from practice, not theory.
- The realestate-radar geocoding debug chain (PRs #107–#109) shows three consecutive same-approach PRs before the actual root cause (full-width digits, then house-number stripping, then URL format) was identified. Each PR inherited the prior PR's wrong premise.
- Sprint timeout post-mortems consistently show agents cycling the same tool invocation sequence until context exhaustion. No structured stop-and-pivot mechanism was in place.

The cost of a same-approach retry loop is not just the failed attempts — it is also the opportunity cost of the pivots that were never tried.

## Context

This pattern applies when a single agent is executing an iterative task with a feedback loop (attempt → observe failure → attempt again). It is especially relevant when:

- The task involves debugging, data retrieval, or API interaction where the same call can be retried.
- The failure mode is consistent across attempts (same error, same empty result, same wrong output).
- The agent makes autonomous decisions about retry strategy without a human in the loop.
- Budget (tokens, time, API calls) is finite and a retry loop degrades overall task completion.

It does **not** apply to:
- Transient failures where the same approach is legitimately expected to succeed on retry (e.g., rate-limit back-off, network flap). Use [Rate-Limit Back-Off](/agent-prompt-patterns/patterns/rate-limit-back-off) for that case.
- Tasks where a human explicitly instructs "try again" — that is a user-directed retry, not an agent retry loop.
- Multi-agent swarms where the stall is due to inter-agent divergence rather than single-agent repetition. Use [Convergence Stall Detection](/agent-prompt-patterns/patterns/convergence-stall-detection) for that case.

## Solution

**Maintain an attempt counter per sub-problem. After 2 failed attempts with the same approach class, STOP. Explicitly articulate what is different about the next strategy before proceeding. If no pivot is available, escalate immediately with a structured stuck diagnosis.**

### Step 1: Define "approach class" for the current task

**Two attempts belong to the same class if they share the same constraint model — the same assumption about why the prior attempt failed.** The tool used and the input provided are secondary signals that often *reveal* whether the constraint model changed, but they are not themselves the deciding criterion.

| Axis | Role | Same class indicator | Different class indicator |
|---|---|---|---|
| **Constraint model** | **Primary (deciding)** | Same assumption about failure cause | New hypothesis or inverted assumption |
| **Tool** | Secondary | Same API call, same shell command | Different tool, different data source |
| **Data / Input** | Secondary | Same underlying source, same assumptions about the input | Different normalization, different source |

**Using the secondary axes**: a different API call that still assumes the same wrong root cause is the same class. A superficially identical tool invocation with a genuinely different hypothesis about the failure is a different class. When in doubt, ask: "Has my model of *why* this is failing changed?" If no, it's the same class.

### Step 2: Track the attempt counter (per sub-problem)

The counter tracks same-class attempts. An agent may pivot at any point when a failure clearly falsifies the current hypothesis — the threshold enforces a **maximum** on same-class retries; it does not require exhausting all N attempts before pivoting.

```
attempt_count = 0       # resets when a genuinely different strategy is adopted
MAX_ATTEMPTS = 2        # default threshold per sub-problem

while task_not_complete:
    result = execute(current_strategy)

    if result.succeeded:
        attempt_count = 0
        # continue with next step

    else:
        attempt_count += 1

        # Evaluate after each failure — pivot as soon as the hypothesis is falsified,
        # do not wait for the counter to reach MAX_ATTEMPTS if a pivot is obvious.
        new_strategy = identify_pivot_if_hypothesis_falsified(current_strategy, result)

        if new_strategy is not None:
            # Genuine pivot: reset counter and continue with new strategy
            current_strategy = new_strategy
            attempt_count = 0
            # loop continues: next iteration executes current_strategy (the pivot)

        elif attempt_count >= MAX_ATTEMPTS:
            # Threshold reached and no pivot available — escalate
            escalate(current_strategy, result, attempt_count)
            break

        # implicit: attempt_count < MAX_ATTEMPTS and no pivot yet → retry is still in budget
        # re-read the failure before retrying — do not blindly re-execute
```

**Reset the counter only on a genuine pivot**: if the new strategy passes the approach-class test above (different constraint model), reset `attempt_count = 0`. If it does not, do not reset — carry the counter forward.

### Step 3: Mandatory pivot check before attempt N+1

Before the N+1 attempt, complete this articulation:

> *"Attempt [N] failed with [failure mode]. My prior assumption was [X]. That assumption is now falsified. My new approach is [Y], which is different because [Z]. If this assumption is also wrong, I will surface a stuck diagnosis."*

If the articulation would truthfully read: *"I'm trying the same thing again but phrasing it slightly differently"* — that is a red flag. Do not proceed. Move directly to escalation.

Common legitimate pivot directions:

| Prior approach | Pivot |
|---|---|
| API call with query A | Different API endpoint or data source |
| Parsing raw bytes | Normalize encoding first (e.g., NFKC for CJK data) |
| Fetching a URL directly | Fetch via different client (node https vs. web_fetch) |
| Patching code at line X | Re-read root cause from scratch; do not patch the same area |
| Same shell command retried | Check whether the tool itself is the wrong tool |

### Step 4: Escalation path when no pivot is available

If no pivot is identifiable after N attempts, surface a **stuck diagnosis** immediately. Do not silently continue until timeout. A stuck diagnosis is more valuable than a timed-out empty-handed sprint.

Structured format:

```
STUCK DIAGNOSIS — max-retry-pivot threshold reached.

Sub-problem: [what was being attempted, narrowly scoped]
Attempts: [N]
Approach class: [same constraint model across all attempts — describe the shared assumption]
Failure mode: [consistent error or wrong output observed each time]
Pivots considered: [list alternatives evaluated and why each was ruled out]
Recommended next step: [what a human or a differently-instrumented agent should try]
Blocking question (if any): [what information is needed to unblock]
```

This summary gives the operator enough to either unblock the agent (provide missing information, grant a different tool, correct the environment) or redirect to a different strategy without re-running the same loop.

## Anti-pattern: "one more try"

The canonical anti-pattern is retrying without an articulated hypothesis change:

> *"Let me try that again."*
> *"Attempting the same operation once more."*
> *"Retrying — the issue may have been transient."*

Unless the failure mode is explicitly identified as transient (rate limit, network flap, lock contention), these phrases are signals that the agent is in a same-class retry loop. Each attempt must answer: **"What do I believe is different about this attempt vs. the last?"** If the answer is "nothing," the answer is to pivot or escalate, not to retry.

## Calibrating the threshold

**Default: N=2 per sub-problem.** Rationale:

- **N=1** is too aggressive. A single failure should prompt re-reading the error and confirming the hypothesis is falsified before pivoting — not an immediate unconditional pivot.
- **N=2** matches the human heuristic: if a second attempt with identical logic fails, the logic is wrong, not execution. This is the threshold codified in the autogent `when-debugging` playbook.
- **N=3** may be appropriate for sub-problems with a known base rate of same-approach retries that are genuinely expected before the hypothesis is resolvable (e.g., lock contention that may take 2 retries to clear even without a strategy change). Require explicit documentation of why N=3 is chosen for a given sub-problem.

Set the threshold **per sub-problem** before starting that sub-problem — different sub-problems in the same task can legitimately have different retry characteristics. Do not use a single task-level threshold that overrides per-sub-problem judgment. Do not adjust a sub-problem's threshold mid-flight — mid-run threshold increases defeat the purpose.

## Evidence

**autogent PLAYBOOK `when-debugging` trigger**: codified as "A fix doesn't work after 2 attempts → MUST load section." This is a standing operational rule derived from sprint postmortem analysis. The 2-attempt threshold was not set by fiat; it emerged from observing that agents rarely recover a same-approach retry on attempt 3.

**realestate-radar geocoding debug chain (PRs #107–#109)**: three consecutive PRs each inherited the prior PR's incorrect root-cause assumption — first attributing geocoding failures to query format, then to house-number stripping, then to URL format. The actual root cause (full-width digit normalization, NFKC) was found only on PR #109. A max-retry-pivot rule with N=2 would have forced a pivot at PR #108 and likely surfaced the encoding root cause one PR earlier.

**Sprint timeout post-mortems**: multiple sprint sessions in the autogent system terminated with a timeout rather than a result, and post-mortem review found the final N tool calls were structurally identical to the prior N calls — same query, same file, same command. No progress was made in the final third of the context window. A max-retry-pivot check at the approach level would have halted the loop and produced a stuck diagnosis instead.

**Evidence level: strong** — the 2-attempt rule is an active, standing operational directive (not a retrospective observation), supported by at least two independent documented multi-attempt failure chains and a pattern of sprint timeout post-mortems attributable to same-approach cycling.

## Tradeoffs

**Benefit**: Loops that would otherwise exhaust the context window and produce a timeout failure instead terminate at the threshold: either with a genuine pivot that changes the strategy, or with a structured stuck diagnosis when no pivot is available. Recovery time drops from "full context window + timeout" to "N same-class attempts + pivot-or-escalate."

**Cost**: Requires the agent to classify each attempt's approach class before executing it — a small cognitive overhead per attempt. For tasks with a very low retry rate, the classification cost may exceed the loop-prevention benefit.

**Watch out for**:

- **Misclassifying transient failures as same-class**: if the failure mode changes between attempts (different error, different partial output), the attempts may not be same-class even if the tool is the same. The constraint model axis is the deciding one: if the assumption about the failure changes, it's a different class.
- **Pivot that is nominally different but functionally identical**: changing one parameter of a query while keeping the same underlying assumption is not a genuine pivot. Require the articulation to name a different constraint model, not just different parameter values.
- **Threshold set too high for budget-constrained tasks**: in a sprint with a 4-hour wall clock, N=5 may use up the entire budget on retries for a single sub-problem. Scale the threshold to the task's total budget.
- **Counter not reset on genuine progress**: if a pivot succeeds on the first attempt, the counter should reset to zero before the next sub-problem. Carrying a counter across unrelated sub-problems produces false positives.

## Related Patterns

- **[Convergence Stall Detection](/agent-prompt-patterns/patterns/convergence-stall-detection)** — the multi-agent and multi-step version of this pattern. Convergence stall detection tracks whether the overall task state is advancing; max-retry-pivot tracks whether individual approach attempts are diversifying. They are complementary: max-retry-pivot fires first (per-attempt), convergence stall detection fires later (per-task-state).
- **[Constraint Falsification Before Planning](/agent-prompt-patterns/patterns/constraint-falsification)** — explicitly falsify blocking assumptions before accepting them. Max-retry-pivot is triggered *after* a failure; constraint falsification is applied *before* each attempt to ensure the assumption being tested is worth testing.
- **[Hypothesis Before Action](/agent-prompt-patterns/patterns/hypothesis-before-action)** — states an explicit falsifiable hypothesis before each intervention. Max-retry-pivot depends on hypothesis-before-action: to count approach classes, the agent must have articulated what it believes and why. Without an explicit hypothesis, "approach class" cannot be reliably determined.
- **[Operator-Blocked Escalation Ladder](/agent-prompt-patterns/patterns/operator-blocked-escalation-ladder)** — the escalation path when all pivots are exhausted. Max-retry-pivot defines *when* to escalate; the escalation ladder defines *how* — which channel, what format, what priority.
