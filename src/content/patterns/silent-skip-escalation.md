---
title: "Silent Skip Escalation"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Pair every agent early-return/skip path with a consecutive-occurrence counter and escalation logic. A skip that is correct for transient conditions becomes an invisible outage when it persists — debug-level logs disappear into noise while the agent silently stops doing its job."
relatedPatterns: ["circuit-breaker", "side-effect-verification", "follow-through-discipline"]
tags: ["autonomy", "reliability", "logging", "silent-failure", "scheduler", "escalation", "observability"]
---

## Problem

Agents and long-running tasks often have early-return paths: "if resource unavailable, log and return." These paths are correct for transient conditions — brief lock contention, a momentarily busy session pool, a rate-limit window. The agent skips one tick; the next tick succeeds; no harm done.

But when the condition becomes persistent, the same code path produces a silent outage.

**Silent failure anatomy (real incident — autogent #558, 2026-06-14):**

- Tick 1: session pool busy → `log.debug("skipping — session pool unavailable")` → return
- Ticks 2–107: same code path, same debug log, no escalation
- Outage duration: 1h47m (107 skipped iterations at 1-min intervals)
- Detection: a user noticed a scheduled task hadn't produced output; no alert had ever fired

The debug log was correct on tick 1. It was an invisible lie on tick 107.

**The falsification test:** "What signal would I see if this skip became persistent for an hour?" If the answer is "nothing" — it's this failure class.

The root cause is a conflation of two distinct conditions in a single logging level: "skip expected, transient" (debug) and "skip persisting, investigate" (warn). The agent has no mechanism to distinguish them, so it never escalates.

## Context

This pattern applies to any agent, daemon, or scheduler with:

- Conditional skip paths (busy check, lock acquisition, rate limit, precondition check)
- Tick-based or interval-based execution loops
- Silent-by-design background operation (no human in the loop per tick)

It is especially important when the skipped work has external consumers — users waiting for output, downstream systems expecting data, scheduled tasks that queue silently.

It does **not** apply to one-shot tasks with no retry loop. If the agent runs once and fails, the failure is immediately visible. The escalation pattern is for loops where individual skips are invisible by design.

## Solution

**Pair every skip path with a consecutive-occurrence counter and escalation threshold.**

```
consecutiveSkips = 0

on skip:
  consecutiveSkips++
  if consecutiveSkips % WARN_EVERY == 0:
    log.warn(f"Skipping for ~Xmin ({consecutiveSkips} consecutive) — investigate")
  else:
    log.debug(f"Skipping — condition unmet (skip #{consecutiveSkips})")

on successful execution after skips:
  if consecutiveSkips > 0:
    log.info(f"Recovered after {consecutiveSkips} skipped iterations")
  consecutiveSkips = 0
```

**Key design decisions:**

1. **`WARN_EVERY` corresponds to real time, not tick count.** A good default is `Math.max(2, Math.ceil(15 / tickIntervalMinutes))` — an escalation approximately every 15 minutes of continuous skipping. At 1-min ticks that's 15; at 5-min ticks that's 3; at 15-min+ ticks the `Math.max(2, ...)` floor gives 2, meaning the second consecutive skip escalates (already 30+ min of missed execution — appropriate). The guard prevents WARN_EVERY=1, which would escalate on the very first skip and defeat the "transient skips stay quiet" design goal.

2. **The debug path is preserved, not replaced.** Transient skips stay quiet. The pattern adds escalation for persistence — it does not make every skip noisy. This is the critical distinction from "just log at warn level always."

3. **Recovery log closes the signal loop.** The `log.info` on recovery is as important as the warn escalation. Without it, an operator seeing the warn has no way to know when the condition cleared. The recovery log also confirms the counter reset correctly and the agent is healthy.

4. **Counter is in-memory state (not persisted to storage).** For tick-based loops, an in-memory counter suffices — it resets on restart, which is fine because a restart naturally breaks the skip chain. If the agent is truly stateless between invocations (e.g., a cron that spawns fresh processes), store the skip count in a lightweight key-value store or the agent's memory topic. **Concurrency note**: if multiple instances can run overlapping ticks, a shared in-memory counter races — use an atomic store or accept that escalation is approximate (each instance escalates independently, which is often acceptable).

### TypeScript implementation

```ts
class MyScheduler {
  private _consecutiveSkips = 0;

  async tick(): Promise<void> {
    if (this.sessionPool.isBusy()) {
      this._consecutiveSkips++;
      const WARN_EVERY = Math.max(2, Math.ceil(15 / (this.tickIntervalMinutes || 1))); // guard: tickIntervalMinutes must be positive
      if (this._consecutiveSkips % WARN_EVERY === 0 && this._consecutiveSkips > 0) {
        const minutes = Math.floor(this._consecutiveSkips * this.tickIntervalMinutes);
        log.warn(
          `Skipping tick — session pool busy for ~${minutes}min ` +
          `(${this._consecutiveSkips} consecutive skips) — investigate`
        );
      } else {
        log.debug(
          `Skipping tick — session pool busy ` +
          `(skip #${this._consecutiveSkips})`
        );
      }
      return;
    }

    // Recovery signal — log before resetting so the count is available in the message
    if (this._consecutiveSkips > 0) {
      log.info(`Session pool recovered after ${this._consecutiveSkips} skipped ticks`);
      this._consecutiveSkips = 0;
    }

    // ... normal tick work (note: if work throws here, the counter is already reset;
    // acceptable for most cases — if you need "confirmed recovery only on full success",
    // move the reset to after the work block completes)
  }
}
```

### For prompt-based agents

In agent task prompts, instruct the agent to track and escalate:

```
## Skip Escalation (required for any early-return path)

Track each distinct skip reason with its own current count in memory topic `<task-name>-skip-state`
(key-value: reason → consecutive_skip_count). Separate from an append-only log — counter state
and log entries serve different purposes.

If you exit early because a precondition is unmet (resource busy, rate limited, lock held):
1. Read the current consecutive skip count for this specific reason from `<task-name>-skip-state`.
2. Increment: new_count = (current_count ?? 0) + 1.
3. Write new_count back to `<task-name>-skip-state` for this reason.
4. Compute WARN_INTERVAL as approximately 3 consecutive skips for tasks that run every few
   minutes, or 2 skips for tasks that run every 15+ minutes.
5. If new_count % WARN_INTERVAL == 0 (and new_count > 0): post a visible warning with the reason,
   skip count, and approximate elapsed time, then exit.
6. Otherwise: exit silently (this is the transient-skip path — do not alert).

On any successful run after skips: for each reason whose count > 0, log recovery
("recovered after N skips for reason X") and reset that count to 0 in `<task-name>-skip-state`.

Never silently skip without updating the skip state. Use per-reason counters — a shared
counter conflates unrelated conditions and produces misleading "consecutive" escalations.
```

## Evidence

**Autogent scheduler incident (#558, 2026-06-14):**

- `task-scheduler.ts` had a `if (sessionPool.isBusy()) { log.debug("..."); return; }` path
- The session pool entered a persistent-busy state
- 107 consecutive tick skips over 1h47m: all at `log.debug` level, all invisible in production logs
- Scheduled tasks queued but never executed; users saw no output
- Fix: added `_consecutiveSkips` counter with `WARN_EVERY = Math.ceil(15 / tickIntervalMinutes)` threshold (production code), recovery log, and `log.warn` escalation — this pattern documents the lesson learned and recommends the improved `Math.max(2, Math.ceil(15 / tickIntervalMinutes))` variant to prevent escalation on the very first skip at long tick intervals
- Pattern promoted to PLAYBOOK rule: "Self-Skip Early-Returns Must Escalate"

**Evidence level: strong** — production incident with a specific duration (1h47m), clear root cause, and a deployed fix. The fix has been running in production and the warning pattern has successfully surfaced subsequent transient pool contention events that were resolved before becoming outages.

## Tradeoffs

**Benefit**: A persistent skip transitions from "invisible" to "alertable" after a configurable threshold. The signal arrives at the right granularity — transient skips are still quiet; persistent skips escalate with duration context.

**Cost**: Requires maintaining counter state across ticks. For in-process daemons, this is zero overhead (a class field). For stateless agents, it requires a lightweight persistence mechanism.

**Watch out for**:

- **Counter not reset on recovery**: if the counter is only incremented and never reset, warn logs fire forever after the first 15-skip window, even if the agent is healthy. Reset to 0 on every successful execution.
- **`WARN_EVERY` and long tick intervals**: with `Math.max(2, Math.ceil(15 / tickIntervalMinutes))`, a 15-min tick interval gives `WARN_EVERY = 2`, meaning the second consecutive skip (already 30 min of missed execution) triggers a warn. For tasks with very infrequent ticks where even one skip is meaningful, lower the floor below 2 explicitly.
- **Multiple skip conditions in one loop**: if a loop has N different early-return paths, each should have its own counter. A shared counter would misattribute escalations to the wrong condition.
- **Restart resets the counter**: for long-running conditions that survive restarts, an in-memory counter will silently reset. If restarts are frequent and the condition is persistent, use persistent storage for the skip count.

## Related Patterns

- **[Circuit Breaker](/agent-prompt-patterns/patterns/circuit-breaker)** — where the circuit breaker trips a task after N low-quality runs, silent skip escalation fires a warn after N consecutive skips; the patterns complement each other for different failure modes (quality degradation vs. execution failure)
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — both patterns address silent failure; side-effect verification handles "tool returned without error but nothing changed"; silent skip escalation handles "agent returned without error because it chose not to act"
- **[Follow-Through Discipline](/agent-prompt-patterns/patterns/follow-through-discipline)** — the recovery log (the `log.info` on success after skips) is a follow-through signal: it closes the incident loop and confirms the agent resumed normal operation
