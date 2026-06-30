---
title: "Convergence Stall Detection"
category: "error-recovery"
evidenceLevel: "emerging"
summary: "Agents can loop without making measurable forward progress — re-reading the same files, re-running the same failing test, or repeatedly attempting the same fix strategy. Maintain a lightweight progress ledger and abort or pivot when N consecutive steps leave state unchanged."
relatedPatterns: ["circuit-breaker", "empirical-validation-loop", "constraint-falsification"]
tags: ["autonomy", "error-recovery", "loop-detection", "stall", "progress", "pivot", "escalation"]
---

## Problem

An agent working on a multi-step task gets stuck. Instead of stopping or escalating, it continues executing — re-reading the same files, rerunning the same failing test, or retrying the same patch on the same line. The loop consumes the full context window and terminates with a timeout failure that contains no actionable diagnosis.

**Observed instances:**

- Sprint agents re-ran the same audit 3× in succession (#741 epic body caused re-audit on every tick). The loop only broke when the epic body was manually rewritten to say "Phase 1 COMPLETE."
- Memory-read-before-write loops: an agent searching the same memory topic repeatedly without advancing to a write or a different query.
- CI fix attempts cycling through the same root-cause hypothesis after a misdiagnosis — applying the same patch variant, observing the same failure, applying again.

The common structure: **no progress signal is defined, so the agent cannot detect that it is not advancing**. Without a defined signal, "keep trying" is the only available strategy.

## Context

This pattern applies when an agent is executing a multi-step task where each step is supposed to advance toward a goal state. It is especially relevant when:

- The task involves a feedback loop (edit → test → observe → edit).
- The agent makes autonomous decisions about what to try next (not just following a fixed checklist).
- Failure is non-terminal — the task framework does not crash on a bad step, so the agent can keep executing indefinitely.
- The context window is large enough that looping is not immediately obvious from the output volume.

It does not apply to tasks with a single action (e.g., "write this file"), or to agents that are purely reactive (e.g., answering a single user question with no iteration).

## Solution

**Before starting a multi-step task, define a progress signal. After each action, compare state before and after on that signal. If state is unchanged for N steps (default: N=3), declare a stall and execute the stall-escape protocol.**

### Step 1: Define the progress signal

The progress signal must be concrete and measurable for the specific task. Examples:

| Task type | Progress signal |
|---|---|
| Fix a failing test | Number of passing tests increases |
| Implement a feature | Files changed / lines of new code differ from last step |
| Research a topic | New search returns at least one result not seen before |
| Debug an error | Stack trace / error message changes |
| Refactor code | A different module or symbol is touched |

Choose a signal that **cannot stay identical if real progress is occurring**. "I'm still thinking about it" doesn't count.

**Canonicalization note**: Some signals contain nondeterministic noise — stack traces include memory addresses, test output includes timestamps, search results include ordering. Canonicalize before comparing: strip addresses and timestamps from stack traces, sort and deduplicate search result IDs, normalize whitespace. Without canonicalization, two runs with identical *meaningful* output can look superficially different and silently evade the stall detector.

### Step 2: Maintain a progress ledger

Track state on the signal after each action:

```
progress_ledger = []
stall_count = 0
STALL_THRESHOLD = 3

for step in task_steps:
    state_before = snapshot_progress_signal()
    execute(step)
    state_after = snapshot_progress_signal()

    progress_ledger.append(state_after)  # record every step for escalation summary

    if state_after == state_before:
        stall_count += 1
    else:
        stall_count = 0

    if stall_count >= STALL_THRESHOLD:
        log_stall_and_escape()
        break
```

The ledger records every step (not just progressing ones) so the escalation summary can report "Last observed values" accurately. Store only the canonicalized signal values (e.g., pass count, file hash, unique result IDs) — not full output. Prune to the last 10 entries to keep context bounded.

### Step 3: Stall-escape protocol

When the stall threshold is reached:

1. **Log explicitly**: what was attempted, what the progress signal showed, how many consecutive unchanged steps occurred.
2. **Pivot** (preferred): try a qualitatively different strategy.
3. **Escalate** (if no pivot is available): stop and produce a structured failure summary for the user.

| Stall type | Escape |
|---|---|
| Same test keeps failing | Re-read root cause from scratch; do not patch same line again |
| Same search returns same results | Expand query terms; try file system scan instead |
| Same file unchanged after edits | Verify file path; check for write permissions; consider whether a different file is the real target |
| Epic re-audits instead of implementing | Rewrite epic body to say "Phase N COMPLETE — implement sub-issue #X next" |
| Memory search loops | Switch from recall to a direct file scan; broaden query terms |

### Step 4: Reset on genuine progress

The stall counter resets to zero whenever the progress signal advances toward the goal. "Advances toward the goal" means the new state is closer to task completion — not just different from the previous step.

**Oscillation trap**: If the progress signal is defined as "different from the previous step," an agent can oscillate between two equivalent-failure states (A → B → A → B) without ever advancing, and the stall counter resets at every transition. To prevent this, track whether the *new state has been seen before* in the ledger, not only whether it differs from the immediately preceding state. If the new state matches any prior ledger entry, treat the step as a stall rather than progress.

```
# Oscillation-aware version:
if state_after == state_before or state_after in progress_ledger[-STALL_THRESHOLD:]:
    stall_count += 1
else:
    stall_count = 0
```

## Calibrating the threshold

N=3 is the recommended default. Rationale:

- **N=1** produces false positives: some legitimate steps leave state temporarily unchanged (e.g., setting up a precondition before an action that changes state).
- **N=3** is low enough to avoid wasting most of a context window on a loop, while tolerating a single unchanged intermediate step.
- **N=5** may be appropriate for tasks with natural batching (e.g., running a long compilation before observing test output), where two intermediate steps could legitimately show no change.

The threshold should be set before the task starts, not adjusted mid-run. Adjusting mid-run defeats the purpose.

## Structured failure summary (when escalating)

If no pivot is available after N unchanged steps, produce a summary in this form:

```
STALL DETECTED after 3 consecutive unchanged steps.

Progress signal: [what was being tracked]
Last observed values: [signal value at step 1], [step 2], [step 3]
Attempted strategies: [list of distinct approaches tried]
Hypothesis: [most likely root cause, even if unverified]
Suggested next step: [what a human should try, or what information would unblock]
```

This summary is the minimum actionable output of a stalled run. A timeout with no diagnosis is a failure; a stall summary with a clear hypothesis is a useful artifact.

## Evidence

**Source**: Multiple autogent sprint incidents, 2026.

**Epic re-audit loop (#741)**: A sprint agent dispatched against an epic issue re-ran a "Phase 1 audit" on three consecutive ticks before the cause was identified (the epic body still said "run the audit" without marking Phase 1 complete). No progress signal was defined, so the agent had no mechanism to detect it was repeating work. Fix required manual rewrite of the epic body. If a progress signal had been defined ("epic body has been updated to Phase 2"), the stall would have been detectable after the first repeated run.

**CI fix cycles**: Multiple instances of agents applying a variant of the same patch after observing the same failure output. In each case, the root cause was misdiagnosed on the first pass, and subsequent attempts inherited the wrong premise. A stall detector with "error message changes" as the progress signal would have forced a re-read-from-scratch strategy after 3 unchanged error outputs.

**Evidence level: emerging** — observed across at least 3 independent incidents. Pattern not yet systematically instrumented across agent runs; stall counts not formally tracked. Elevation to "moderate" after 2–3 more documented and instrumented instances.

## Tradeoffs

**Benefit**: Loops that would otherwise exhaust the context window and produce a timeout failure instead terminate with a structured diagnosis. Recovery time drops from "context window + timeout" to "N steps + pivot."

**Cost**: Defining a progress signal requires forethought before the task starts. For tasks with no obvious measurable signal (e.g., "explore this codebase and propose improvements"), the progress signal is harder to define and may require proxies (e.g., "at least one new file has been read").

**Watch out for**:

- **Gaming the signal**: An agent that knows about the stall detector may take a low-value action that technically changes state (e.g., re-reading a different file, not the relevant one) to reset the counter. Mitigation: require the progress signal to advance toward the *task goal*, not just any state change.
- **Overly sensitive signals**: If the progress signal is too granular (e.g., "any change to any file"), it fires on noise. Calibrate signals to task-level granularity (e.g., "the specific failing test's output changes").
- **Stall at the wrong level**: A stall detector watching test pass count won't catch a stall in the *planning* phase before any tests are run. For long tasks, consider a hierarchy of signals (planning signal → implementation signal → verification signal).
- **Escalation without context**: A bare "I'm stuck" message is not useful. Enforce the structured failure summary format — the hypothesis and suggested next step are the minimum useful output of a stall.

## Related Patterns

- **[Circuit Breaker for Recurring Agent Tasks](/agent-prompt-patterns/patterns/circuit-breaker)** — convergence stall detection is a per-task loop guard; the circuit breaker is a per-*schedule* guard. They are complementary: stall detection prevents loops within a single run, the circuit breaker prevents a recurring task from running after it has stopped producing value across runs.
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — the progress signal in stall detection is analogous to the measurable outcome in empirical validation: both require defining what "progress" looks like before observing it.
- **[Constraint Falsification Before Planning](/agent-prompt-patterns/patterns/constraint-falsification)** — CI fix loop stalls often stem from a false "blocked" premise inherited from a misdiagnosis. Constraint falsification prevents the misdiagnosis; stall detection catches the loop when it happens anyway.
