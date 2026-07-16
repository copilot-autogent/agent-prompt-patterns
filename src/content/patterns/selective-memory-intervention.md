---
title: "Selective Memory Intervention"
category: "memory-management"
evidenceLevel: "moderate"
summary: "In long-horizon tasks, agents suffer behavioral state decay — decision-relevant information gets buried in expanding context. Naive solutions fail: always-on retrieval floods context, passive banks require explicit queries (and agents forget to ask), advisor-only guidance doesn't intervene at action time. The pattern: separate the intervention decision from the action agent. A lightweight intervention policy monitors trajectory and injects memory only at critical decision points — task-branch detection, constraint-violation risk, re-derivation detection, and temporal dependencies — staying silent otherwise."
relatedPatterns: ["memory-read-before-write", "strategic-recall-before-ideation", "proactive-constraint-recall", "feedback-loop-via-memory", "belief-entropy-checkpointing"]
tags: ["memory", "intervention", "long-horizon", "context-management", "selective-retrieval", "trajectory-monitoring", "behavioral-state-decay", "sprint-supervision"]
---

## Problem

In long-horizon tasks, agents face **behavioral state decay** — decision-relevant information gets buried in expanding context. The naive solutions each fail:

- **Always-on retrieval**: Floods context with irrelevant memory, diluting signal and adding token cost
- **Passive memory banks**: Agent must explicitly query; forgets to ask when it matters most
- **Advisor-only guidance**: Memory is consulted but doesn't intervene in the action loop

Real example: A sprint times out on orientation burn (reading repo structure for 4 hours) because it never recalled that a similar issue was attempted and failed with a specific approach — the memory existed but wasn't surfaced at the critical decision point.

## Context

Agents with persistent memory systems (topics, vector DBs, knowledge graphs) face an **intervention timing problem**: when should memory be injected into the agent's context, and when should it stay silent?

This pattern applies when:
- Agent handles multi-step or long-horizon tasks where relevant state is scattered across sessions
- Memory retrieval has a cost (tokens, latency, or cognitive load)
- Over-retrieval dilutes signal; under-retrieval causes re-derivation

## Solution

Implement a **memory intervention policy** that decides WHEN to surface WHAT, rather than always-on or query-only retrieval.

### Core Mechanism

**Separate the intervention decision from the action agent:**

1. **Intervention agent** (lightweight, runs alongside action agent):
   - Monitors recent trajectory (what the agent is doing, what it's planning)
   - Maintains a structured memory bank (past attempts, constraints, failures, key facts)
   - **Decides**: Should I inject a reminder now, or stay silent?

2. **Action agent** (task logic unmodified):
   - Executes the task as normal; its core reasoning loop is unchanged
   - Receives memory-grounded reminders ONLY when the intervention agent deems it critical (injected via system-prompt prefix, in-context message, or scratchpad)
   - Otherwise operates with clean context
   - Note: Pattern A (pre-task injection) does augment the action agent's system prompt — "unmodified" refers to its task-execution logic, not its initial context

### Intervention Triggers (When to Surface)

Inject memory when:
1. **Task-branch detection**: Agent is about to make a decision with known failure modes (e.g., choosing an approach that failed before)
2. **Constraint violation risk**: Agent's plan would violate a known constraint (e.g., "don't edit /app directly" rule)
3. **Re-derivation detected**: Agent is re-solving a problem already solved (e.g., re-debugging a bug with a known root cause)
4. **Temporal dependency**: Agent needs context from a previous session to proceed (e.g., "this PR builds on #123, recall its design decisions")

Stay silent when:
- Memory is tangential to current decision
- Agent hasn't reached a decision point yet (still orienting)
- Injecting would duplicate information already in context

### Implementation Patterns

**Pattern A: Pre-task selective injection** (autogent-style)
```
Before launching sprint agent for issue #456:
1. Analyze issue body + recent failed PRs + related issues
2. Identify critical memory topics (failures on similar tasks, relevant constraints)
3. Inject topic slugs into sprint system prompt:
   "Recall these before planning: failed-attempt-log, api-rate-limit-rules"
```

**Pattern B: Mid-task monitoring + injection** (Meta "Remember When It Matters" style)
```
While agent executes:
1. Memory agent observes trajectory (tool calls, plan updates)
   ⚠️  Avoid storing or replaying sensitive content from trajectories (secrets,
       credentials, source/config data, PII) — redact before recording.
2. When agent proposes action X, memory agent checks: "Did X fail before?"
3. If yes → inject reminder (once per unique failure; skip if same note was
   already injected this session to prevent reminder loops):
   "FYI: Approach X was attempted in PR #123 and failed because..."
4. If no → stay silent
```
> **Freshness caveat**: check that the stored failure is still relevant — a constraint relaxed or a bug fixed since the failure record was written can produce false-positive blocks. Tag failure records with version, repo, branch, environment scope, and task context; skip injection if the codebase, config, or task scope has materially changed since the failure was recorded.

**Pattern C: Query-guided selective retrieval**
```
Agent explicitly signals when it needs help:
Agent: "I'm deciding between approach A and B for authentication"
Memory system: [Searches past attempts, finds B failed in PR #99]
Memory system: "Approach B was tried in PR #99 — auth token expiry wasn't handled.
               Consider approach A or handle expiry explicitly."
```
> **Distinction from passive retrieval**: Pattern C differs from a passive memory bank in that the query is triggered mid-task at a specific decision point (not at session start, and not "recall everything related to this issue"). The signal is structured: the agent names the decision it's making. The failure mode noted in the Problem section — "forgets to ask when distracted" — still applies if Pattern C is the only mechanism; combine with Pattern A (pre-task injection of high-priority topics) so critical constraints surface unconditionally.

## Evidence

**Academic validation**: Meta AI's "Remember When It Matters" (arXiv 2607.08716, July 2026)
- Separate memory agent running alongside action agent
- Selective intervention outperforms:
  - Passive bank exposure (+0pp baseline)
  - Always-on injection (−2.1pp — context bloat)
  - Advisor-only guidance (+3.4pp — doesn't intervene at action time)
  - General retrieval (+4.2pp — no trajectory awareness)
- **Selective intervention: +8.3pp on Terminal-Bench, +6.8pp on τ²-Bench**

> Note: This is a single recent preprint; results have not yet been independently replicated. The evidence level reflects strength of the mechanism and operational corroboration, not a mature literature review.

**Operational corroboration**: Pre-task selective injection (Pattern A) has been independently observed to reduce re-derivation failures in long-horizon sprint agents, consistent with the mechanism the paper describes.

## Trade-offs

### Pros
- **Reduces context bloat**: Only inject when needed, not always-on
- **Prevents re-derivation**: Agent doesn't waste cycles rediscovering known facts
- **Improves long-horizon success**: Critical information surfaces at decision points

### Cons
- **Requires intervention logic**: Can't just expose a memory API; need trajectory monitoring + decision logic
- **False negatives**: If intervention policy misses a critical moment, agent proceeds without key context
- **Complexity**: Separate intervention agent (or pre-task analysis) is more complex than passive retrieval

## Anti-patterns

❌ **Always-on memory injection**: "Recall all topics related to this task" → floods context, dilutes signal

❌ **Query-only (passive)**: Agent must remember to ask → forgets when distracted or under cognitive load

❌ **Advisor without intervention**: Memory consulted but doesn't block bad actions at the moment they're chosen

## Examples

### Example 1: Sprint orientation hint (autogent)

**Problem**: Sprint times out on a large issue, burning 4 hours reading repo structure before ever branching.

**Solution**: Before launching sprint, analyze issue + recent timeouts. Inject orientation hint:
```
Sprint orientation (read these topics first):
- `repo-structure-overview` (5min cap)
- `similar-issue-123-failed-approach` (don't retry naive search)
```

**Outcome**: Sprint orients in 30 min, implements in 1.5h — total 2h vs. 4h timeout.

### Example 2: Constraint violation prevention

**Problem**: Agent about to execute a destructive command that violates a known workspace isolation rule.

**Memory intervention**:
```
⚠️ CONSTRAINT VIOLATION DETECTED
You're about to run: rm -rf /prod/node_modules
Recall from `workspace-rules`:
"Production directories are read-only. All modifications go through a
 dedicated dev workspace under /tmp or equivalent."
```

**Outcome**: Agent aborts destructive action, switches to dev workspace.

### Example 3: Failed-approach recall

**Problem**: Agent proposes using library X for auth, which failed in PR #99 (token expiry bug).

**Memory intervention**:
```
FYI: Library X was attempted in PR #99 (closed without merge).
Root cause: Token expiry handling missing → requests fail after 1h.
Alternatives tried: Library Y worked (PR #105 merged).
```

**Outcome**: Agent skips library X, uses library Y, avoids re-discovering the same bug.

## Validation Checklist

Before adopting this pattern, verify:
- [ ] You have a persistent memory system (topics, DB, graph)
- [ ] Over-retrieval (always-on) causes measurable problems (context bloat, signal dilution, token cost)
- [ ] Under-retrieval (passive) causes measurable problems (re-derivation, repeated failures)
- [ ] You can identify decision points where memory would change the outcome
- [ ] You have a mechanism to decide WHEN to inject (pre-task analysis, mid-task monitoring, or query-guided)

## When to Use

Use this pattern when:
- Agent handles multi-session or long-horizon tasks
- Memory exists but isn't consistently used at critical decision points
- Over-retrieval (always-on) causes context bloat or dilutes signal
- Under-retrieval (passive) causes re-derivation or repeated failures

Don't use when:
- Tasks are single-session and short (memory overhead not worth it)
- Agent has no persistent memory system
- Context window is unlimited and token cost is not a concern (though signal dilution still applies)

## Implementation Notes

**Autogent implementation** (Pattern A: pre-task injection):
- Sprint-supervisor analyzes issue before dispatch
- Identifies relevant memory topics (failed attempts, constraints, dependencies)
- Injects topic slugs into sprint system prompt
- Sprint recalls topics before planning

**Frontier research** (Pattern B: mid-task monitoring):
- Memory agent monitors action agent's trajectory (tool calls, plans)
- On decision point (e.g., "should I use approach X?"), checks memory
- Injects reminder if past attempts failed
- Stays silent if no relevant history

## Meta

**Pattern origin**: Synthesized from Meta AI's "Remember When It Matters" (arXiv 2607.08716) and operational experience with pre-task injection in long-horizon sprint supervision. Contributed 2026-07-16.

**Cross-references**:
- Academic: Meta AI behavioral state decay research (arXiv 2607.08716)
- Related patterns: `memory-read-before-write`, `strategic-recall-before-ideation`, `proactive-constraint-recall`, `feedback-loop-via-memory`, `belief-entropy-checkpointing`
