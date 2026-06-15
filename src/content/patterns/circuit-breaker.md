---
title: "Circuit Breaker for Recurring Agent Tasks"
category: "agent-autonomy"
evidenceLevel: "moderate"
summary: "Add a self-rating step and auto-disable logic to any recurring agent task. Without a quality signal and circuit breaker, busywork loops run indefinitely — tasks show as completed but produce no novel value, with no signal to the operator."
relatedPatterns: ["proactivity-injection", "bounded-autonomy", "feedback-loop-via-memory"]
tags: ["autonomy", "recurring-tasks", "quality", "self-rating", "circuit-breaker", "busywork", "auto-disable"]
---

## Problem

A recurring agent runs reliably. Logs show "completed." The user sees no errors. But output has silently degraded — safe maintenance tasks, obvious follow-ups, boilerplate summaries. No novel proposals. No surprising connections. No decisions that required the agent at all.

The problem isn't a crash. It's a quality cliff the system has no way to detect.

Two failure modes converge here:

**Silent busywork**: The agent exhausts its genuine backlog but keeps running. It finds low-value tasks that technically satisfy "task completed" — renaming a field, reformatting a note, summarizing a summary. Compute and budget drain. The user stays unaware.

**No operator signal**: Unlike crashes or timeouts, quality degradation produces no alert. The user would need to read every output carefully to notice. Recurring tasks are specifically designed to run without supervision. There is no natural review point.

The root cause: recurring agent tasks have success criteria defined at the level of "did it run?" not "was the output worth running?"

## Context

This pattern applies to any recurring agent task that:

- Runs on a schedule without direct user supervision per execution
- Has a finite domain of genuinely novel work (backlogs, research topics, creative proposals)
- Produces output that is qualitatively distinguishable from maintenance-only output
- Uses compute and budget that should be conserved for high-value work

It's especially relevant when agents also use **Proactivity Injection** — the circuit breaker is the quality guardrail for proactivity prompts. If the proactivity step stops generating novel proposals, it's not producing value; it's producing the appearance of value.

The pattern does not apply to agents with purely mechanical tasks that have no quality gradient (e.g., "ping this endpoint and report status"). Those tasks either succeed or fail — there's no busywork failure mode.

## Solution

**Include a self-rating step and auto-disable circuit breaker at the end of any recurring agent task prompt.**

```
## Quality Rating (required — append to every response)

Rate this run's output:
- 3 = Genuinely novel — unexpected connection, new proposal, surprising insight
- 2 = Useful but predictable — real value, expected domain, not novel
- 1 = Busywork — safe maintenance, obvious follow-up, no new value added

Append to your response: [QUALITY: N]

## Circuit Breaker

Check your quality history (stored in memory topic `<task-name>-quality-log`):
1. Append this run: { date: <ISO date>, rating: <N>, reason: "<one line>" }
2. If this is your 3rd consecutive rating-1 run:
   - Auto-disable this scheduled task
   - Post alert: "⚡ Circuit breaker triggered — 3 consecutive busywork runs. Manual review needed before re-enabling."
   - Do NOT continue with any task work
```

**Critical design choices:**

1. **Rating must be self-applied, not inferred by an observer.** The agent has direct access to what it produced and why. Post-hoc observers don't. The self-rating also acts as a reflection prompt — agents that must justify a "1" often catch themselves mid-busywork.

2. **Threshold is 3 consecutive, not 3 total.** A single useful run resets the counter. This prevents false positives from tasks that have a natural ebb/flow of high and low value weeks.

3. **The circuit breaker trips auto-disable, not just a warning.** A warning without action is noise. The task should stop running and require manual re-enable. The cost of one missed run is lower than weeks of undetected busywork.

4. **Quality log in memory.** The agent needs cross-run state. A memory topic (`<task-name>-quality-log`) is the simplest implementation: the agent reads it at start, appends at end, checks the circuit breaker condition. No external infrastructure required.

5. **Position at the end of the prompt.** Like the Proactivity Injection step, the circuit breaker rating must come after core task completion, not before. An agent that checks ratings first might self-limit productive work.

### Calibrating the rating scale

The 3-point scale is intentionally coarse. Fine-grained scales introduce calibration drift — agents spend effort on the rating rather than on the work. The three categories correspond to distinct behavioral signals:

| Rating | Behavioral signal | Example |
|--------|------------------|---------|
| 3 | Agent-originated proposal, unexpected cross-domain find | "Found a pattern from blog research that applies to the SRS scheduler" |
| 2 | Backlog execution with genuine user value | "Completed the tag page feature as specified" |
| 1 | Agent running to avoid empty output | "Reformatted README headers for consistency" |

When in doubt between 2 and 1, ask: "Would the user have noticed if this run hadn't happened?" If no, it's a 1.

## Evidence

**Source**: Prompt Lab Experiment 9 (2026-05-09 to 2026-05-25), documented in `prompt-lab-findings` memory.

6 recurring sprint agents were monitored across 4 weeks using a 3-point quality self-rating system (A/N/I: Actionable, Novel, Impact — isomorphic to the 3/2/1 scale above). Each run was also rated by an independent reviewer to validate the self-rating calibration.

Results:

- All 6 variants produced at least one rating-3 run in weeks 1–2
- 3 variants (**9b, 9c, 9e**) degraded to backlog-execution mode by weeks 3–4, logging consecutive rating-1 runs — would have triggered the circuit breaker
- 3 variants (**9a, 9d, 9f**) maintained rating-2+ throughout — circuit breaker correctly would not have triggered
- Self-ratings correlated with independent reviewer ratings (no systematic inflation observed)

The busywork failure was not visible in task completion logs. All 6 variants showed "completed" on every run. The quality signal was the only way to distinguish degraded from healthy agents.

**Evidence level: moderate** — replicated across 6 independent agent variants over 4 weeks. Single experiment; not yet replicated across different agent frameworks or task domains.

## Tradeoffs

**Benefit**: Quality degradation produces a visible signal and automatic shutdown rather than running indefinitely. Operator is alerted at the right time — when manual review is actually needed.

**Cost**: Requires the agent to maintain cross-run state. A memory topic is the minimal implementation; if the memory write fails, the circuit breaker has no history to check. Mitigation: treat a missing or unreadable quality log as a soft-fail (log a warning, don't trip the breaker on a missing first entry).

**Watch out for**:
- **Rating inflation**: agents may self-rate 2 when the honest answer is 1, to avoid triggering the breaker. Counter-balance with explicit instructions: "If you would be uncomfortable showing this run's output to the user as a representative example, rate it 1."
- **False trips from low-backlog periods**: Some tasks legitimately have quiet periods (post-sprint cooldowns, seasonal research gaps). Consider the threshold as a default — for tasks with known quiet periods, use 5 consecutive rather than 3.
- **Alert fatigue**: If the circuit breaker trips frequently across multiple tasks, the alerts become noise. Each trip should require human sign-off before re-enable, not just a re-enable flag.
- **Quality log growth**: Append-only logs accumulate indefinitely. Prune to the last N entries (e.g., 20) to keep memory topic size bounded.

## Related Patterns

- **[Proactivity Injection](/agent-prompt-patterns/patterns/proactivity-injection)** — the circuit breaker is the quality guardrail for proactivity prompts; when proactivity injection stops generating rating-3 output, the circuit breaker ensures the task self-limits rather than running indefinitely
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — the circuit breaker auto-disable is itself a bounded-autonomy action: the agent acts unilaterally on "disable this task" because that decision is explicitly pre-authorized by including the pattern
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — the quality log stored in memory is the cross-run feedback mechanism that makes the circuit breaker stateful across sessions
