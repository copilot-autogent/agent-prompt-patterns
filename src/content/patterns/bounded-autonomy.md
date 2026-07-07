---
title: "Bounded Autonomy"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Give autonomous agents an explicit decision taxonomy: a list of what they can decide unilaterally vs. what requires human escalation. Without explicit boundaries, agents oscillate between over-asking (friction) and under-asking (safety risk), often on the same run."
relatedPatterns: ["proactivity-injection", "dispatcher-pattern", "observer-actor-separation", "capability-preflight-gate"]
tags: ["autonomy", "decision-making", "escalation", "gates", "self-decidable", "safety", "recurring-tasks"]
---

## Problem

You deploy an autonomous agent. You want it to handle routine work without interrupting you. But the agent doesn't know where "routine" ends and "judgment call" begins.

Two failure modes emerge:

**Over-asking**: The agent asks permission for trivial things — bug fixes with obvious root causes, patch-version dependency bumps, stale branch cleanup. Every run produces a question you shouldn't need to answer. You stop trusting the agent to handle anything independently.

**Under-asking**: The agent merges architectural changes, creates new features, or changes user-facing behavior without input. You discover the decision after the fact. Trust collapses from the other direction.

Often *both* failures occur in the same system: an agent that asks about trivialities and acts unilaterally on significant decisions. The agent has no principled way to distinguish them.

## Context

This pattern applies to any autonomous agent that:

- Runs on a recurring schedule without direct supervision
- Has both read and write access to production systems, repositories, or memory
- Is expected to exercise some independent judgment
- Needs to maintain user trust over many sessions

It becomes critical when the agent is multi-functional — handling both routine maintenance and creative or architectural work in the same sessions.

## Solution

**Embed an explicit decision taxonomy directly in the agent's prompt.** Not a general principle ("use good judgment") but a concrete, scannable list of examples in each category.

```
## Decision Authority

### Self-decidable — act + report:
- Bug fixes with clear root cause and well-understood fix
- Patch/minor dependency updates (no breaking changes)
- Documentation-only changes
- Stale branch cleanup
- Dockerfile / infra fixes (no runtime behavior change)
- Proactive fixes surfaced by your own health checks or audits

### Requires human input — ask explicitly:
- Architecture changes or new subsystems
- Major dependency upgrades (potential breaking changes)
- New user-facing features or behavior changes
- Kill/pivot decisions on ongoing projects
- Any change touching authentication, permissions, or external data sharing

When asking: state exactly what you need decided, provide options if applicable.
Do NOT bury the ask in a status update — make it impossible to miss.
```

**Critical design choices:**

1. **Concrete examples, not abstract rules**: "Use good judgment" produces arbitrary behavior. A scannable list of 5-7 examples per category trains the agent's decision classifier against real cases. The examples should come from your actual domain.

2. **Name the failure modes**: Include a sentence about what happens when agents over-ask (friction, trust loss) and under-ask (safety risk). Agents with explicit failure mode awareness are measurably more calibrated than those with only positive rules.

3. **Escalation protocol alongside the taxonomy**: Tell the agent HOW to escalate, not just WHEN. "State exactly what you need decided" and "make it impossible to miss" are load-bearing instructions — without them, agents bury escalations in status text where they get overlooked.

4. **Review and extend the taxonomy**: The list is a living document. After each session, review whether any edge cases arose. Recurring ambiguities belong in the taxonomy, not in agent memory.

## Evidence

In a multi-agent autonomous system running 6 sprint agents plus a daily initiative agent, the following was observed across 8+ weeks of production operation:

**Before explicit taxonomy:**
- Agents asked permission for single-line bug fixes and concurrent-safe refactors (obvious decisions)
- Agents merged multi-PR dependency upgrades that required Docker rebuild to take effect, without flagging the operational complexity
- Session logs showed escalation rate that had no correlation with actual decision difficulty — trivial and significant decisions were asked about at similar rates
- Action rate: ~13% across all sessions (87% of sessions produced no autonomous action, even for clearly self-decidable items)

**After embedding explicit decision taxonomy:**
- Trivial-decision ask rate dropped measurably; agents began acting on patch updates, documentation, and obvious bug fixes without prompting
- Complex-decision escalations became higher-signal: when an agent did ask, it was almost always legitimately ambiguous
- Agents explicitly cited the taxonomy when reporting: "Acting on this directly (bug fix with clear root cause)" or "Escalating: this changes user-facing behavior"
- False negatives (significant decisions made without escalation) tracked to cases where the taxonomy didn't cover the specific scenario — each one was added to the list

**A critical secondary effect**: Explicit taxonomy entries serve as documentation. New sessions reading the prompt know immediately what the agent's operating envelope is, without needing to infer it from behavior history.

**Anti-pattern validated**: Replacing the taxonomy with "use judgment to decide what needs approval" regressed behavior within 3 sessions. Without specific examples, agents defaulted to conservative over-asking on new scenarios and under-asking on familiar ones.

## Tradeoffs

**Benefit**: Dramatically reduces unnecessary escalations while improving the signal quality of the ones that do occur. Builds user trust through predictable, principled behavior.

**Cost**: The taxonomy requires maintenance. Missing categories create blind spots — the agent acts unilaterally on uncovered scenarios because they don't pattern-match to "requires escalation."

**Watch out for:**
- **Taxonomy drift**: The agent's environment changes (new tools, new project types) but the taxonomy doesn't. Schedule taxonomy reviews alongside capability additions.
- **Category boundary cases**: Some decisions are genuinely ambiguous (a bug fix that requires an architectural workaround, for example). Add a third category if needed: "ask for confirmation before proceeding" for these cases.
- **Taxonomy bypass via rationalization**: Agents can argue that a significant change is actually a "bug fix." Include a specific note: "when in doubt about classification, escalate."
- **Over-rigid taxonomy**: If the self-decidable list is too restrictive, agents will ask about trivialities again. The list should feel slightly generous — the goal is to give agents room to act confidently on clear cases.

## Related Patterns

- **[Proactivity Injection](/agent-prompt-patterns/patterns/proactivity-injection)** — defines *what* to act on; Bounded Autonomy defines *when* to act vs. escalate. Use together: proactivity injection surfaces the proposal; bounded autonomy determines whether to act on it immediately or bring it to the user.
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — the dispatcher is the routing layer; bounded autonomy is the authorization layer. Dispatcher answers "who handles this"; bounded autonomy answers "can anyone handle this without human input?"
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — bounded autonomy is best assessed in the observer role: observe the decision, classify it against the taxonomy, THEN decide whether to act or escalate.
