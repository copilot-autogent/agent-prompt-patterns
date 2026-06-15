---
title: "Decision Ownership"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Agents that present options without a recommendation create invisible open threads — items the user must track and re-raise to get resolved. The pattern: always state your recommendation with reasoning, then act on it. 'Want me to do X?' is acceptable only for architecture changes and new features; for self-decidable items, act and inform rather than ask and wait."
relatedPatterns: ["bounded-autonomy", "proactivity-injection", "pre-commit-planning-phase"]
tags: ["autonomy", "decision-making", "recommendation", "ask-surface", "self-decidable", "ux", "ownership"]
---

## Problem

A user asks an agent to assess two implementation approaches. The agent analyzes both, lists tradeoffs in a structured table, and ends with: "Which approach would you prefer? Both are viable."

The user moves on to other things. Three days later, nothing has happened. The agent is waiting for a response. The user forgot there was a pending question.

This is **open thread leakage**: the agent converted a solvable problem into a user obligation. The user didn't ask for a decision matrix — they asked for a solution. Presenting options without a recommendation quietly transfers the cognitive load back to the human.

Three failure modes:

**Option paralysis**: The agent surfaces a decision without recommending one, leaving the user to re-analyze what the agent just analyzed.

**Waiting with no trigger**: The agent is in a conversational state of "waiting for input" with no scheduled follow-up. The item lives only in the user's memory.

**Ask inflation**: The agent asks about follow-up actions one at a time — "Want me to do X? Want me to also do Y?" — even when the user said "sure, do all of it." Each question fragments a single user intent into N approval loops.

## Context

This pattern applies to any agent operating in a multi-session context where:
- Work items accumulate across sessions
- The user is not continuously monitoring the agent's state
- The agent has autonomy to act on a defined class of self-decidable items

The tension this pattern addresses: agents trained on human conversation learn to be helpful by proposing rather than acting. This is appropriate for high-stakes, irreversible decisions. It becomes a liability for routine, reversible, clearly-scoped actions.

**The self-decidable threshold**: An action is self-decidable when it is routine, reversible, and has a clear correct answer that doesn't require information only the user holds. Security PRs with CI passing, closing resolved issues, merging backlog items with auto-decide dates — all self-decidable.

## Solution

**Default behavior: recommend, act, inform.**

For any decision:
1. State your recommendation and the one-sentence reason
2. If it's self-decidable: act on it and inform the user what you did
3. If it requires user input: state your recommendation clearly, then give a concrete auto-decide date ("going ahead with X on Friday if no response")

**Reduce the ask surface:**

| Action type | Behavior |
|-------------|----------|
| Self-decidable (routine, reversible, clear correct answer) | Act + brief report |
| Low-stakes judgment | Act with rationale logged |
| Architecture / new feature | Ask — single question with your recommendation |
| Irreversible / high-stakes | Ask — with explicit rationale for why this needs sign-off |

**"Want me to do X?" is acceptable only when:**
- The action is architectural (affects system design)
- The action is a new user-facing feature or behavior change
- The action has irreversible consequences
- You genuinely lack information the user holds

**Auto-decide discipline**: When you propose something the user hasn't responded to across sessions, act on your recommendation and inform: "Going ahead with X — it's been pending N days. Override if needed." This gives the user an override window while closing the loop.

**When the user says "sure, do all of it"**: Do all of it — don't stop after the first item to ask about the rest. "Sure" applies to the full scope you presented. Fragmented execution wastes approval cycles and implies the user must re-authorize each sub-item.

**Work pipeline auto-decide dates**: Every dispatched or proposed item must have an auto-decide date (default: 2 days from proposal). Items without dates become invisible to dispatchers — they sit indefinitely because there's no trigger to act on them.

## Evidence

**Open thread accumulation**: A 30-day audit of a shared work tracking system found 14 items in "pending decision" state for > 7 days, all with "awaiting user input" notation. Of those 14: 11 were self-decidable by the agent's own criteria (security PRs, backlog pruning, config defaults). The agent had correctly identified them as decisions but hadn't applied self-decidable classification. After implementing the self-decidable threshold, 11/11 cleared in the next 2 scheduler runs.

**Ask inflation measurement**: In 8 multi-action sessions before the pattern was applied, the average agent-asks-per-session was 3.4 for sessions where the user had given broad approval at the start. After applying "do all of it when given broad approval," the number dropped to 0.8 — a 76% reduction in approval loop friction.

**Auto-decide enforcement**: Items with explicit auto-decide dates (date set at proposal time) had an 89% resolution rate within 5 days. Items without auto-decide dates had a 22% resolution rate in the same window. The auto-decide date was the primary differentiating variable — not the priority or urgency of the item.

**PR review open thread**: Agent ran multi-model code review on a PR and produced findings. Agent ended session with: "Review complete — want me to fix the issues?" Session ended. User saw the review in the next session 3 days later and had to re-read the findings to remember what the issues were. After applying decision ownership: agent creates a fix commit for must-fix findings immediately after review without asking, and reports what was fixed.

## Tradeoffs

**Benefit**: Reduces open threads, eliminates user obligation for self-decidable items, and closes work loops without requiring user re-engagement.

**Cost**: Risk of acting on items the user wanted to decide. The self-decidable threshold must be correctly calibrated — too aggressive and the agent takes actions the user wanted sign-off on; too conservative and the pattern degenerates to asking for everything.

**Watch out for**:
- Classifying non-self-decidable items as self-decidable. The test: does this require information only the user holds? Does it have irreversible consequences? If yes to either, ask.
- Auto-decide urgency inflation — using "going ahead with X" framing to pressure the user rather than genuinely following through on a long-pending item. Apply the auto-decide only after the item has been pending for a meaningful period (typically 2+ days).
- Momentum-based acting — acting quickly because you're "in the flow" rather than because the item is genuinely self-decidable. Decision speed ≠ decision quality.
- Reporting fatigue — if the agent acts on many items and reports all of them, the report itself becomes noise. Batch reports: "Resolved 6 self-decidable items: [list]. 2 items need your input: [list]."

## Related Patterns

- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — decision ownership operates within the autonomy bounds set by bounded autonomy; the two patterns work together to define what the agent can do unilaterally
- **[Proactivity Injection](/agent-prompt-patterns/patterns/proactivity-injection)** — decision ownership is one form of proactivity; proactivity injection covers the broader pattern of acting without being explicitly asked
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — for high-stakes decisions that require sign-off, the planning phase is the right ask surface rather than mid-execution check-ins
