---
title: "Execution Budget-Aware Dispatch"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Sub-agents dispatched to a fixed execution budget (e.g., 4-hour task timeout) have no visibility into their remaining time. When discovery cost is high, the agent can exhaust the budget orienting — reading source structure, picking an approach — before writing a single line of code. The fix: estimate orientation cost before dispatch, embed an orientation hint for high-cost tasks, and split tasks that are clearly too large to fit in one execution window."
relatedPatterns: ["long-horizon-task-phasing", "phase-gated-epic-body", "structured-handoff-header", "dead-sprint-recovery", "workspace-per-sprint-isolation"]
tags: ["multi-agent", "dispatch", "execution-budget", "orientation", "timeout", "task-splitting", "sprint", "reliability", "planning"]
---

## Problem

A feature task is dispatched to a sub-agent with a 4-hour execution budget. The agent starts, reads the source tree, explores related modules, considers implementation approaches, and writes planning notes. At the 4-hour mark, it times out — no branch created, no commits, no recoverable state. The supervisor re-dispatches identically. The same timeout occurs. Two full execution windows are consumed by repeated orientation, with zero artifacts produced.

Three failure signatures:

**Orientation burn**: The agent spends the majority of its budget on discovery activities (reading files, understanding conventions, deciding on approach) rather than on implementation. Orientation is invisible from the outside — the agent appears to be working — and produces no committed output that survives the session.

**Silent budget depletion**: Unlike a human who can say "I've been reading code for 3 hours and haven't started implementing," the agent has no mechanism to signal that it's running low on budget or to escalate scope concerns. It continues orienting until terminated.

**Undifferentiated retry**: After a timeout, the supervisor's natural response is to re-dispatch the same task. Without diagnosing the failure root cause, the retry reproduces exactly the same conditions and hits the same timeout. Each retry burns an entire execution window.

The root cause is a mismatch between task scope and execution budget, combined with a dispatch that provides no constraint on how much budget the agent may spend on orientation vs. implementation.

## Context

This pattern applies when:

- Sub-agents run under a hard execution budget (wall-clock timeout, token cap, or resource limit)
- Tasks vary in orientation cost — some are small and well-scoped; others require significant upfront discovery in a large or unfamiliar codebase
- The dispatcher (supervisor, scheduled task, or human) controls what goes into the task body but cannot control how the agent allocates its budget internally
- Agents have no built-in mechanism to signal "I am spending too much budget on orientation" or to request scope clarification mid-run

It is most critical for:

- **Full-feature tasks** combining foundation work (data model, core logic) with surface work (UI, wiring, tests) — each component alone might fit in one window; together they don't
- **Unfamiliar codebases** where the agent must read significant source before it can begin implementing
- **Tasks dispatched after a long gap** since the last session, where the codebase has evolved and the agent cannot rely on prior orientation

It is less applicable to:

- Small, narrowly scoped tasks (a single file change, a targeted bug fix in a known module) where orientation cost is minimal
- Tasks where the agent has already oriented in a prior session and the task body includes explicit file references and a first step

## Solution

**Before dispatching, estimate orientation cost. For high-cost tasks, embed an orientation hint directly in the task body. For tasks too large to fit in one window, split before dispatching.**

### 1. Estimate orientation cost before dispatching

Ask: how much of the execution budget will discovery consume?

| Signal | Orientation cost estimate |
|---|---|
| Small, scoped change in a well-known module | Low — skip hint |
| New feature in a familiar codebase, single area | Medium — short hint |
| New feature spanning multiple subsystems | High — full hint |
| Full-stack feature (engine + UI + tests) in a large codebase | Very high — consider splitting |
| Unfamiliar codebase, no prior orientation | High regardless of scope |

A useful heuristic: if you cannot write "start by reading `src/X.ts`" in the task body, you do not know enough about the codebase yourself to scope the task. Do the orientation yourself first, then write the hint.

### 2. Embed an orientation hint for high-orientation-cost tasks

Add a short **Sprint orientation hint** section directly to the task body — not just the dispatch prompt. Sprints read the issue body; a hint in the body survives across re-dispatches and is visible to any agent that picks up the task.

**Orientation hint format:**

```markdown
## Sprint orientation hint

1. Read `src/<top-level-structure>` first (5-min cap — stop reading and start implementing)
2. Implement the core function / module in isolation before any UI or wiring
3. Write a unit test for the core module immediately after it passes
4. Push a working branch within 30 min so CI runs in parallel with further work
5. Wire UI / surface code only after core + tests are green
```

**Key elements:**

- **Named entry points**: specify which files or directories to read first — not "read the codebase" but "read `src/engine/` and `src/types.ts`"
- **Explicit time cap on orientation**: "5-min orientation cap, then start implementing" — this is the behavioral constraint that prevents open-ended discovery
- **Implementation order**: core module before surface code, so if the budget is exhausted, at least the core artifact is committed
- **Early milestone**: "push a working branch within 30 min" — gives CI time to run in parallel and creates a recoverable artifact early (omit or adjust this step if the environment has no CI-on-push or branch-push is gated)
- **Sequencing rationale**: "wire UI only after core tests are green" — prevents the agent from attempting to implement and test everything simultaneously

### 3. Split tasks that are clearly too large for one execution window

If a task requires both foundational work and surface work and the codebase is large, split the task before dispatching — not after a failed attempt.

**Split pattern:**

```
Issue #N: [Full feature title]
├── #N-E1: [Core/engine component] — data model, core logic, unit tests
│   Produces: merged PR with passing tests for core module
└── #N-E2: [UI/wiring component] — depends on #N-E1 artifact
    Entry condition: E1 PR merged at SHA {sha}
    Produces: integrated feature, E2E tests, deployed to staging
```

Each sub-task:
- Fits in one execution window (estimated)
- Produces a committed, verifiable artifact
- Has an explicit entry condition derived from the prior task's artifact
- Can be re-dispatched without duplicating prior work

**Splitting decision rule**: if you cannot write a concise orientation hint that fits in 5 bullet points, the task is probably too large to fit in one execution window. Split it.

### 4. On timeout: diagnose before re-dispatching

When a dispatch times out with no committed artifacts, diagnose the failure mode before re-dispatching:

| Observed pattern | Most likely cause | Action |
|---|---|---|
| No commits on expected branch | Orientation burn (agent never started implementing) — also check for auth/push failures or environment setup crashes | Add orientation hint to task body, verify environment, re-dispatch |
| Commits present, implementation incomplete | Scope too large for one window | Split remaining work, re-dispatch E2 starting from last committed state |
| Commits present, blocked on external dependency | Blocker encountered mid-flight | Remove blocker, update task body with what's complete, re-dispatch |
| Repeated timeout across two dispatches | Task is structurally too large | Split before third dispatch |

**Do not blind-retry.** A re-dispatch without diagnosis reproduces the same conditions and hits the same timeout. The only change between the failed dispatch and the successful re-dispatch should be: (a) an orientation hint added to the task body, (b) the task split into a smaller sub-task, or (c) a blocker removed.

### 5. Reserve budget for the critical path

The task body is the primary lever for shaping how the agent allocates its execution budget. A task body that describes the full feature context in 500 words, with no orientation structure, signals to the agent that all 500 words are equally important and that the agent should understand all of it before starting. A task body with an explicit orientation hint signals that 5 specific files matter and implementation should start in minute 5.

**Front-load enough context that the agent can start implementing within the first 10% of its budget.**

For a wall-clock-based 4-hour budget, this means: by the ~24-minute mark, the agent should have branched, created the core file, and committed at least a scaffold. For token-based or other budget types, translate "10%" to the equivalent threshold for your environment. If it has not, something in the task body is causing over-orientation. The orientation hint is the tool to correct this.

## Evidence

**realestate-radar #172 (2026-07-13):** A sprint for a full feature (engine + UI + tests) was dispatched without an orientation hint. The agent spent its entire 4-hour execution budget orienting — reading source structure, deciding on implementation approach — and timed out having never created a branch or committed any work. Re-dispatch WITH a body-embedded orientation hint ("read `src/` top-level structure first, 5-min cap; implement the pure core function + unit test in isolation before any UI; branch within 30 min") completed successfully in **34 minutes (2058s)**.

Key facts:
- Both dispatches had identical agent instructions, model, and task scope
- The only change was 5 bullet points added to the issue body
- The first dispatch produced zero committed artifacts after 4 hours
- The second dispatch produced a merged PR after 34 minutes
- The orientation hint imposed no constraints that prevented the agent from solving the full task — it reduced discovery waste, not capability

**CONTEXT.md pattern (autogent, 2026-07-13):** The behavior was codified into the CONTEXT.md of the autogent repository (a separate multi-project agent orchestration system) as an operational rule: "A sprint that TIMED OUT once on orientation burn re-dispatches reliably if you bake an orientation hint into the ISSUE BODY... don't blind-retry — add the orientation hint to the body first. (Pairs with the split-if-still-timing-out fallback: E1 core/engine + E2 UI.)"

## Tradeoffs

**Benefit**: Near-100% completion rate for tasks that previously timed out. The orientation hint has essentially zero cost — 5 bullet points added to the task body. The first dispatch is more expensive to plan (the dispatcher must know enough to write the hint), but this front-loads cost that the agent would have paid anyway — less efficiently — during execution.

**Cost**: Writing an orientation hint requires the dispatcher to know enough about the codebase to name the right entry points. If the dispatcher doesn't know, they must orient first. This shifts orientation cost from agent-time to dispatcher-time — which is more efficient when the dispatcher can cache that knowledge across multiple dispatches, and roughly cost-neutral for one-off tasks.

**Watch out for:**

- **Hint staleness**: An orientation hint that references specific file paths becomes stale as the codebase evolves. Hints written for a codebase three months ago may point to files that have moved or been renamed. Keep hints short and structural ("read `src/` top-level") rather than brittle and specific ("read `src/engine/v2/processor.ts` line 47").

- **Over-constraining the implementation path**: An overly prescriptive hint ("implement it by subclassing `BaseProcessor`") may steer the agent toward an implementation path that is no longer correct. Hints should constrain *orientation and sequencing*, not *implementation choices*.

- **Skipping the split when it's needed**: An orientation hint reduces orientation waste but cannot make a fundamentally oversized task fit in one window. If the task requires 6 hours of implementation work, a hint reduces waste but does not change the fundamental scope mismatch. Split tasks that are genuinely too large rather than trying to optimize a task that cannot succeed in one window regardless of orientation efficiency.

- **Hint in the dispatch prompt vs. hint in the issue body**: Hints in the dispatch prompt (the supervisor's direct message to the agent) apply only to the current dispatch. Hints in the issue body persist across re-dispatches and are visible to any agent that picks up the issue. For recurring or re-dispatchable tasks, the hint must be in the issue body.

## Related Patterns

- **[Long-Horizon Task Phasing](/agent-prompt-patterns/patterns/long-horizon-task-phasing)** — complementary for very large tasks that span multiple sessions; execution budget-aware dispatch addresses single-window orientation waste; long-horizon task phasing addresses work that legitimately spans multiple sessions with structured handoffs between them
- **[Phase-Gated Epic Body](/agent-prompt-patterns/patterns/phase-gated-epic-body)** — structuring epic issue bodies to prevent re-audit on each dispatch; the orientation hint is the single-task analog of the phase gate — it tells the agent what to do first and explicitly excludes re-running already-completed orientation
- **[Structured Handoff Header](/agent-prompt-patterns/patterns/structured-handoff-header)** — handing off context mid-task when an agent must transfer work; for split tasks (E1 → E2), the E1 completion artifact is the handoff header that E2 reads at the start of its execution window
- **[Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery)** — recovering after a sprint dies mid-flight; execution budget-aware dispatch is the preventive complement — apply this pattern before dispatch; apply dead sprint recovery after a sprint has already failed
- **[Workspace-per-Sprint Isolation](/agent-prompt-patterns/patterns/workspace-per-sprint-isolation)** — giving each spawned agent an isolated working directory; isolation ensures that a re-dispatch after a timeout does not collide with any uncommitted state left by the timed-out agent
