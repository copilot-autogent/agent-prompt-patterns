---
title: "Parallel Tool Call Batching"
category: "task-design"
evidenceLevel: "moderate"
summary: "Agents frequently issue independent tool calls sequentially, waiting for each result before issuing the next. This multiplies latency linearly with the number of calls and wastes turn budget. Group all independent tool operations into a single response; sequence only when the output of call N is required as input to call N+1."
relatedPatterns: ["enumeration-first-verification", "structured-handoff-header"]
tags: ["efficiency", "parallel", "tool-calls", "latency", "batching", "turn-budget", "performance"]
---

## Problem

Agents frequently make tool calls sequentially when the calls are fully independent — each call waits for the previous one to complete before the next is issued. This multiplies latency linearly with the number of calls:

```
# Sequential (BAD): 3 reads × 500ms each = 1,500ms total
read file A  →  read file B  →  read file C
```

This creates four compounding failure modes:

**Linearly compounding latency**: 5 independent reads that take 300ms each take ~350ms batched vs. ~1,750ms sequential — a 5× wall-clock difference. This scales with the number of calls.

**Wasted turn budget**: Many agent environments limit total turns or have per-response costs. Sequential independent calls burn multiple turns where one would suffice.

**Spurious sequential dependencies**: Agents sometimes read one file and then decide what to read next *based on that result*, even when all required files were knowable upfront — creating an artificial sequence where none was necessary.

**Context bloat from intermediate overhead**: Multiple round-trips to the same tool (grep, glob, view) each introduce intermediate responses, filling context with overhead that adds no signal.

## Context

This pattern applies during any agent execution phase that involves multiple tool calls to gather information or perform independent operations:

- **Investigation phases**: reading multiple known files, running multiple searches, checking multiple state sources
- **Ideation phases**: exploring multiple codebase areas independently, running dedup searches for multiple candidates
- **Verification phases**: checking multiple independent conditions before acting

The pattern is especially important when:
1. You can enumerate the required tool calls *before* making the first one
2. The task has a bounded turn budget (sprints, rate-limited environments)
3. Latency is user-facing (interactive sessions, real-time feedback)

The pattern does **not** apply when:
- Calls have true data dependencies (the output of call A is required as input to call B)
- Ordered side-effecting operations where sequence matters (write then verify — not verify then write)
- Interactive debugging where each result genuinely and unpredictably determines what to check next

## Solution

**Group all independent tool operations into a single response. Only sequence when the output of call N is required as input to call N+1.**

```
# GOOD: parallel batch (one response, three simultaneous reads)
[read file A, read file B, read file C]
→ All three results available in the next turn

# BAD: sequential (three responses, three round trips)
Turn 1: read file A
Turn 2: read file B
Turn 3: read file C
→ Same result, 3× the latency and 3 turns consumed
```

### Decision rule for sequencing

Apply this decision rule at the point of issuing any tool call:

```
Are all inputs to call N+1 known before call N completes?
  YES → batch with N (parallel)
  NO  → sequence (N must complete first)
```

The decision is about *knowability upfront*, not just *logical order*. If you could have issued all calls in the same response, you should have — even if one call's result happened to confirm the others were appropriate.

### Common parallelizable patterns

| Scenario | Parallel strategy |
|----------|------------------|
| Read multiple known files | Batch all read/view calls in one response |
| Search multiple independent patterns | Batch all grep/glob calls in one response |
| Check multiple API endpoints | Batch all fetch calls in one response |
| Explore multiple codebase areas | Batch all investigate calls in one response |
| Run dedup searches for multiple candidates | Batch all search calls in one response |
| Validate multiple independent conditions | Batch all check calls in one response |

### Anti-pattern: spurious sequential dependency

The most common violation is deciding what to read next *after* seeing the first result, when the next read was always knowable:

```
# BAD: agent creates a false sequence despite knowable upfront set
Turn 1: "Let me check the package.json first"  → read package.json
Turn 2: "Now let me check the tsconfig"         → read tsconfig.json
Turn 3: "Now let me check src/index.ts"         → read src/index.ts

# GOOD: task requirements make the full read set clear upfront
Turn 1: [read package.json, read tsconfig.json, read src/index.ts]
→ All three available in turn 2
```

The BAD version isn't just slow — it creates the illusion that each subsequent read was *contingent on* the prior one, when it wasn't. This confounds tool call logs and masks the true independence of the operations.

## Evidence

**Empirical wall-clock measurement**: In a production agentic workflow, independent file reads measured ~300–500ms each. Tasks requiring 5 independent reads took ~350ms batched vs. ~1,750ms sequential — consistent with a 5× wall-clock improvement for fully independent calls. The improvement scales linearly with the number of independent calls.

**Turn budget efficiency**: Agent environments with turn limits (e.g., 40-turn sprints) complete meaningfully more work per turn when parallel batching is applied consistently. A single-turn batch of 5 reads consumes 1 turn vs. 5 turns sequential — a 5-turn savings that compounds across an investigation phase.

**Amdahl's Law applies**: Total speedup is bounded by the sequential portion. Parallelizing independent calls directly reduces the sequential fraction, improving throughput at the task level. For an investigation phase composed of N independent reads (a common case), the sequential fraction approaches 0% when all reads are batched — the entire phase becomes a single turn.

**Operational guideline validation**: This pattern is codified in the operational guidelines of at least one production agentic system as a critical discipline: "When you need to perform multiple independent operations, make ALL tool calls in a SINGLE response." The fact that this rule was deemed important enough to mark as critical — and that it is frequently violated — confirms it is a validated, non-obvious pattern worth explicit documentation.

## Tradeoffs

**Benefit**: Linear latency reduction in investigation phases. Turn budget preserved for implementation and verification rather than consumed by sequential reads.

**Cost**: Requires upfront reasoning about which calls are truly independent before issuing any of them. Agents optimizing locally ("read this, then decide next") must shift to task-level planning ("enumerate all reads the task requires, then issue them together").

**Watch out for**:
- **Premature batching of dependent calls**: The most common mistake in applying this pattern is batching calls that have a genuine data dependency. A write-then-verify sequence is NOT parallelizable. Verify the independence criterion before batching.
- **Partial batching**: Batching 3 of 5 independent calls while issuing the remaining 2 sequentially is better than none, but misses savings. Once in batch-mode thinking, enumerate all independent calls in the current scope before issuing the response.
- **Batch size and context window**: Issuing 20 parallel reads in one response returns 20 results in the next turn. For very large batches, this can create a dense result turn that compresses poorly against context limits. For practical purposes, batch within a scope (e.g., "all files relevant to this module") rather than across the entire task.
- **Side-effecting tool calls**: Non-idempotent calls that modify state (write, create, delete) should only be batched if their independent execution order is genuinely safe. Two writes to the same file are not safe to batch. Two writes to different files typically are.

## Related Patterns

- **[Enumeration-First Verification](/agent-prompt-patterns/patterns/enumeration-first-verification)** — enumerating all items before checking each one is the prerequisite for batching: this pattern converts that enumeration into parallel execution. Without enumeration first, the agent cannot know which calls are independent and batchable.
- **[Structured Handoff Header](/agent-prompt-patterns/patterns/structured-handoff-header)** — context collected via parallel batching can be compactly encoded in a handoff header for downstream agents. The `required_context` field in the handoff pattern maps directly to a parallel read batch at the receiving agent's start.
