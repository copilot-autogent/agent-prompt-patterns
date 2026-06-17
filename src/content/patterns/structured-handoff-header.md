---
title: "Structured Handoff Header"
category: "multi-agent"
evidenceLevel: "moderate"
summary: "Open every dispatched agent prompt with a compact YAML block encoding the full handoff context — intent, required context, success criteria, preconditions, explicit prohibitions, prior failed approaches, and memory update instructions. Free-text dispatch causes scope drift, silent failures, and unauthorized side-effects; a structured header makes the boundary explicit at the point of transfer."
relatedPatterns: ["dispatcher-pattern", "sprint-continuity", "feedback-loop-via-memory"]
tags: ["multi-agent", "handoff", "dispatch", "coordination", "spawn", "scope", "side-effects", "preconditions"]
---

## Problem

Multi-agent systems fail primarily at **boundary crossings** — when state must transfer from one agent context to another. Free-text dispatch creates three failure modes:

**Stale reads**: The receiving agent reads outdated memory and takes a stale action. Without explicit `required_context` instructions, there's no guarantee the agent reads the right topics at the right time.

**Lossy transfer**: Critical constraints fall out of context as the prompt grows. The dispatcher knows "don't merge the PR directly," but that knowledge never reaches the actor. The actor merges it.

**Scope collision**: Parallel agents overwrite each other's work. Without declared scopes, two actors reading "update the manifest" each write their own version, last-write-wins.

**Autogent incident log provides three concrete examples:**

- **I-8 auto-merge incident**: A sprint agent merged a PR in 6 seconds because no `do_not: ["call merge_pull_request"]` constraint was specified. The agent had the tool available, the issue was clear, and it did the obvious thing. The dispatch had no guard.
- **P48 scope misinterpretation**: A re-dispatched agent repeated a prior failed approach because `already_tried` was absent. The new session had no record of what had been attempted, diagnosed the same root cause, and applied the same fix that had already failed.
- **Missing memory updates (multiple incidents)**: Agents updated the wrong topic or section because `memory_to_update` was implicit in prose. "Update the manifest when done" is ambiguous. "Update topic: project-manifest, section: Sprint History" is not.

## Context

This pattern applies to any agent dispatch where:

- The agent has write access (files, memory, PRs, GitHub state)
- The task has a specific scope boundary the agent should not exceed
- The session is a re-dispatch of a previously failed or incomplete sprint
- Multiple agents are running in parallel with overlapping write targets

It does **not** apply to:
- Trivial one-shot read-only queries (no state transfer, no write operations)
- Interactive sessions where the user is guiding the agent turn-by-turn

## Solution

**Open every dispatched agent prompt with a compact YAML block encoding the full handoff context.**

```yaml
HANDOFF_CONTEXT:
  sender: dispatcher-2026-06-17
  intent: fix BUG-3 null pointer in session.ts line 142
  required_context:
    - src/session.ts          # read before starting
    - memory:project-manifest # recall before starting
  expected_output: PR with fix + regression test
  success_criteria:
    - npm test passes with 0 failures
    - No new files outside src/
  preconditions:
    - npm test passes at baseline before changes
    - Branch from main (not from a feature branch)
  do_not:
    - call merge_pull_request directly
    - create new memory topics; update existing ones only
    - push to main directly; PR only
  already_tried: N/A  # or: "Agent X tried Y at Z UTC; failed because W"
  memory_to_update:
    - topic: project-manifest
      section: "## Sprint History"
      update: "Sprint N: [summary of what was done]"

ACK_REQUIRED: |
  Open your FIRST message with:
  "I have read: [list of recalled topics]. Files read: [list].
   Preconditions: [met / NOT MET — reason]."
  Do not start work until ACK is sent.
```

### What each field prevents

| Field | Failure mode prevented |
|-------|----------------------|
| `intent` | Scope drift — agent interprets task differently than sender |
| `required_context` | Missing context — agent acts on stale or incomplete state |
| `success_criteria` | Silent failure — agent completes but output is wrong |
| `preconditions` | Broken-foundation work — building on a failing baseline |
| `do_not` | Unauthorized side-effects (auto-merge, memory creation, direct push) |
| `already_tried` | Repeated failed approach on re-dispatch |
| `memory_to_update` | Wrong-topic or missing memory updates |
| `ACK_REQUIRED` | Context loss surface — forces explicit acknowledgment at turn 1 |

### The anti-pattern it replaces

```
# BAD: free-text dispatch
"Fix the bug in session.ts and update the manifest when done."
→ Agent guesses which bug, ignores manifest, tries to push to main

# GOOD: structured handoff
HANDOFF_CONTEXT:
  intent: fix null pointer in session.ts line 142 (BUG-3)
  do_not: ["push to main directly", "call merge_pull_request"]
  memory_to_update: [{topic: project-manifest, section: "Sprint History", ...}]
→ Agent has exact scope, explicit guards, update instructions
```

### ACK_REQUIRED forces surface-level verification

The `ACK_REQUIRED` block requires the agent to open its first message with an explicit confirmation: which context topics were read, which files were loaded, and whether preconditions are met. This does two things:

1. **Forces the agent to actually read the required context** (not just receive the reference)
2. **Surfaces a broken precondition before work begins** — "Preconditions: NOT MET — npm test failing with 3 errors" is far cheaper to handle than discovering it after an hour of implementation

## Evidence

**DyLAN (COLM2024, arXiv:2310.02170)**: Dynamic LLM-Powered Agent Network reports up to 25% accuracy improvement on specific tasks through structured agent selection and communication. The mechanism is disambiguation at dispatch time — selecting which agents participate and what each is responsible for reduces the coordination overhead that produces failures in unstructured multi-agent pipelines.

**MachineSoM (ACL 2024, arXiv:2310.02124)**: Studies collaboration mechanisms in multi-LLM societies and observes conformity bias — agents in sequential collaboration anchor on prior (sometimes incorrect) responses from earlier agents. The implication for dispatch: parallel agent spawns with isolated, non-shared context (enabled by structured handoffs that declare explicit per-agent scopes) avoid the sequential contamination path this bias exploits.

**Autogent PLAYBOOK implementation**: The autogent project adopted `HANDOFF_CONTEXT` headers in its sprint supervisor prompts after the I-8 and P48 incidents. The pattern is codified in autogent's PLAYBOOK as the standard format for every `spawn_task` dispatch. The pattern addresses the majority of documented sprint coordination failures in autogent's incident log: auto-merge (I-8), scope misinterpretation (P48), stale-memory re-dispatch, and missing memory updates.

**Token cost**: ~180–250 tokens per dispatch header. Whether this overhead is justified depends on dispatch frequency and failure cost — for agents with write access and meaningful side effects, a single prevented incident typically offsets hundreds of dispatch header costs.

## Tradeoffs

**Benefit**: Eliminates the most common class of multi-agent coordination failures at the cheapest possible intervention point — the dispatch prompt itself.

**Cost**: ~200 tokens per dispatch. Slight authoring overhead for the dispatcher to populate all fields. The `memory_to_update` field requires the dispatcher to think about downstream state changes upfront.

**Watch out for**:
- **`do_not` list creep**: Over time, dispatchers accumulate long `do_not` lists from past incidents. Review periodically — many entries become obsolete as agent behavior matures or tool permissions change.
- **Stale `already_tried` entries**: On the third re-dispatch, `already_tried` can contain multiple approaches, some of which were actually partially successful. Keep entries precise: "tried X, failed at step Y because Z" not "tried everything."
- **ACK is self-attestation**: `ACK_REQUIRED` confirms the agent *can restate* the required context — it does not guarantee the underlying recall/read tool calls actually succeeded. If precondition verification matters for correctness, add a runtime check (e.g., verify the baseline test passes before proceeding) rather than relying solely on the ACK message.
- **`ACK_REQUIRED` in one-shot runners**: In async or one-shot dispatchers that don't process a first-turn reply, `ACK_REQUIRED` is unenforceable as a gate. Treat it as a first-message discipline in those contexts rather than a hard start condition.
- **Omitting `preconditions` for "simple" tasks**: The I-8 incident happened on a task that appeared simple. Preconditions are cheapest to populate and most valuable when the task appears straightforward.

## Related Patterns

- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — handles routing and parallelism; this pattern specifies what goes *inside* the routed prompt
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — specialized handoff for multi-session recurring agents; Structured Handoff Header generalizes to any single-dispatch agent
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — handles result capture across sessions; `memory_to_update` in the handoff header provides the capture instructions at dispatch time rather than leaving them implicit
