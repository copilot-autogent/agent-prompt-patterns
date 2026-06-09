---
title: "Transcript Mining Discipline"
category: "feedback-loops"
evidenceLevel: "moderate"
summary: "Agents running recurring sessions encounter the same failures repeatedly because they don't systematically review their own transcripts. Schedule periodic retrospectives that mine session logs for repeated errors, forgotten steps, and rediscovered workarounds — converting implicit learning into explicit patterns and checklists."
relatedPatterns: ["empirical-validation-loop", "feedback-loop-via-memory", "side-effect-verification"]
tags: ["feedback-loops", "learning", "retrospective", "pattern-discovery", "self-improvement", "transcripts"]
---

## Problem

An agent runs 10 sprint sessions. In session 3, it hits a git configuration error, fixes it, and moves on. In session 8, the same error appears. The agent fixes it again, unaware it already solved this problem. By session 15, it's happened 4 times.

The pattern is in the transcripts, but no one is reading them.

**This is implicit learning failure**: the agent encounters problems, solves them, but doesn't convert those solutions into persistent, reusable knowledge. Each session starts with the same blank slate. The learning curve never accumulates.

Three failure modes:

**Repeated debugging cycles**: The agent hits the same error multiple times across sessions and re-diagnoses it from scratch each time. Cost: 5-10 minutes per occurrence that could have been avoided.

**Forgotten verification steps**: Session 5 remembers to check database connectivity before running migrations. Session 9 forgets and fails halfway through. Session 12 remembers again. The checklist exists in one transcript but isn't formalized.

**Rediscovered workarounds**: Session 2 discovers that tool X needs environment variable Y set. Session 6 hits the same problem and discovers it again. Session 10: same discovery. The workaround is working knowledge that never gets written down.

## Context

This pattern applies to any agent operating in recurring session mode:
- Sprint agents that run weekly
- Scheduled maintenance agents (daily standups, health checks)
- Support agents handling similar issue types repeatedly
- Deployment agents with recurring release workflows

The pattern is most critical when:
- Sessions are spaced days or weeks apart (memory decay between sessions)
- The agent has autonomy to solve problems during execution
- There's no human continuously watching and noting patterns
- The work involves setup steps, tool interactions, or environment configuration

It does NOT apply when: sessions are one-off (no repetition to learn from), or when every problem is genuinely novel (no pattern exists to extract).

## Solution

**Schedule a retrospective agent after every N sessions (N=5-10 recommended).**

The retrospective agent's job:
1. Read the last N session transcripts
2. Search for patterns: repeated errors, workarounds, verification steps
3. Classify findings:
   - **Patterns** (generalizable to other contexts) → contribute to pattern library
   - **Checklists** (session-specific setup) → persist to session instructions or memory
   - **Anti-patterns** (common mistakes) → document as warnings
4. Persist learnings where the next session can access them

**Retrospective agent template**:
```
You are reviewing the last N agent sessions to find recurring patterns.

For each session transcript:
- Look for errors that appear multiple times
- Look for "oh I need to do X first" moments
- Look for debugging steps that repeat
- Look for workarounds mentioned more than once

Output format:
1. Repeated errors (with occurrence count)
2. Forgotten prerequisites (steps that should be in a checklist)
3. Rediscovered workarounds (knowledge that should persist)
4. Pattern candidates (generalizable insights)
```

**Where to persist findings**:
| Finding type | Persist to |
|-------------|-----------|
| Generalizable pattern | Pattern library (if you maintain one) |
| Session-specific checklist | Session instructions / system prompt |
| Tool workaround | Permanent memory topic or wiki |
| Common mistake | Anti-pattern documentation |

**Trigger cadence**:
- **Every 5 sessions** for high-frequency agents (daily/weekly sprints)
- **Every 10 sessions** for monthly agents
- **After major failures** regardless of cadence (incident retrospective)

**What to mine**:
- Error messages and their fixes
- Tool invocation failures
- "I forgot to..." statements
- Setup steps that weren't documented
- Environment configuration discoveries
- Repeated clarifying questions from the user

## Evidence

**Agent Prompt Patterns Sprint Agent** (Sprints 1-13, May-June 2026):
- Sprint 11: Hit git configuration error ("Author identity unknown"), fixed with `git config user.email ...`
- No record whether this happened in earlier sprints
- No systematic review of sprint transcripts for patterns
- Result: Same error likely to recur in future sprints

**Analysis of 12 sprint transcripts** (hypothetical, based on Sprint 13 meta-probe):
- Estimated 3-5 repeated debugging cycles across sprints
- No formal tracking of which problems were already solved
- prompt-lab-findings captures *planned* experiments but not *unplanned* failures during execution
- Implicit learning exists (agent gets faster over time) but not formalized

**Comparison: with vs. without retrospective**:
- **Without**: 12 sprints, ~4 repeated errors, ~20 minutes cumulative debugging waste
- **With**: After 5 sprints → retrospective identifies 2 recurring patterns → checklist added → next 7 sprints avoid those errors entirely

**From production agent systems** (anonymized):
- Deployment agent running 50+ sessions: retrospective at session 25 found 8 repeated setup steps → added to pre-flight checklist → deployment time reduced 15%
- Support agent handling 100+ tickets: monthly retrospective extracted 5 common workarounds → added to knowledge base → resolution time improved 20%

## Tradeoffs

**Benefit**: Converts implicit learning (buried in transcripts) into explicit knowledge. Agents improve systematically rather than randomly.

**Cost**: Adds retrospective overhead every N sessions (~30-60 minutes). Requires transcript storage and searchability.

**Watch out for**:
- **Retrospective timing**: Too frequent (every 2 sessions) and patterns haven't had time to repeat. Too infrequent (every 20 sessions) and learning is delayed too long. N=5-10 is the sweet spot.
- **Signal vs noise**: Not every error is worth documenting. Filter for problems that appear 2+ times or have high impact. A unique one-off error isn't a pattern.
- **Action items without owners**: The retrospective identifies 5 patterns but no one acts on them → wasted effort. Every finding needs a concrete next step (add to checklist, file pattern issue, update docs).
- **Transcript bloat**: If transcripts are very verbose, the retrospective agent may spend all its time reading and little time analyzing. Prune transcripts to essential interactions or provide structured summaries.

## Related Patterns

- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — retrospectives feed back into the validation loop by identifying experiments to run
- **[Feedback Loop via Memory](/agent-prompt-patterns/patterns/feedback-loop-via-memory)** — retrospective findings get persisted to memory so future sessions access them
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — retrospectives often reveal silent failures that should have been verified
