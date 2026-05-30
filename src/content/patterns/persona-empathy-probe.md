---
title: "Persona Empathy Probe"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Embed a specific end-user persona in agent prompts to generate higher-fidelity proposals than open-ended proactivity instructions. Instead of asking the agent 'what should we add?', ask 'you are [specific persona with constraints] — what's missing for you?'"
relatedPatterns: ["proactivity-injection", "bounded-autonomy", "observer-actor-separation"]
tags: ["proactivity", "user-centered-design", "persona", "sprint", "proposals", "empathy", "friction"]
---

## Problem

Your autonomous agent has a proactivity step. It completes tasks well, occasionally proposes new features. But the proposals are abstract, scoped for what's technically interesting, not what real users struggle with.

You ask: "What should we add to improve the user experience?" The agent responds with technically-plausible features: search, filters, export buttons. All sensible. None address the actual friction real users hit in the first 30 seconds.

You realize: the agent is optimizing for completeness, not empathy. It doesn't experience the product as a first-time user with constraints. It has infinite patience, perfect memory, no time pressure. Its proposals reflect that privileged position.

## Context

This pattern applies when you want an agent to:

- Propose user-facing improvements (UI, onboarding, content navigation)
- Identify friction points that only matter under specific constraints (time pressure, domain unfamiliarity, mobile context)
- Generate features grounded in user goals, not technical capabilities

It's most effective for agents working on:

- Consumer-facing products (web apps, documentation sites, public APIs)
- Content platforms (blogs, knowledge bases, research collections)
- Tools meant for specific user cohorts (students, first-time buyers, non-technical users)

It complements Proactivity Injection but targets a different failure mode: not "the agent doesn't propose" but "the agent proposes from the wrong vantage point."

## Solution

**Replace open-ended proactivity questions with specific persona probes positioned after core task completion.**

```
## Persona Empathy Step (apply every sprint)
After completing your core task:

Put yourself in the shoes of a specific user:
[Persona definition — concrete role, constraints, goal, time budget]

Example:
"You are a 剛畢業的年輕人 (recent graduate) looking for government subsidies.
You have 30 seconds during a bus commute to find something applicable to you.
Your phone is loading the site for the first time."

Ask:
1. Can this persona achieve their goal in the time budget?
2. What's the FIRST thing that would stop them?
3. If you could add ONE feature to halve their friction, what would it be?

If you identify a clear gap, write it up under 💡 Agent Proposals with:
- The persona constraint that revealed it
- The specific friction point
- The minimal intervention that addresses it
```

**Critical design choices:**

1. **Concrete persona, not general "user"**: "A user visiting the site" is too abstract. "A 剛畢業年輕人 on a 30-second bus ride with a first load" forces specific constraints that surface real friction.

2. **Include constraints that matter**: Time pressure, context (mobile/desktop), domain familiarity, first-visit vs returning. Without constraints, the agent assumes ideal conditions.

3. **Ask for the FIRST blocker, not all problems**: Agents given open-ended questions produce comprehensive lists. The first blocker is where real users abandon. That's the signal.

4. **Minimal intervention focus**: "What ONE thing would halve friction?" prevents agents from proposing full redesigns. Small, testable changes are actionable.

5. **Position after core work**: Same as Proactivity Injection — empathy probes after task completion, not before. Otherwise agents skip the task to run thought experiments.

## Evidence

An autonomous agent system ran 6 recurring sprint agents across different projects. Each sprint was given a different proactivity prompt variant. Three received open-ended proactivity ("propose something new"), three received persona-based empathy probes.

**Persona-probe variants:**

| Project | Persona | Outcome | Fidelity |
|---------|---------|---------|----------|
| Subsidy Radar | "剛畢業年輕人, 30秒找補助 on bus" | Interactive 3-question eligibility quiz + difficulty badges | **HIGH** — directly addressed time-pressure constraint |
| Realestate | "首購族 (first-time home buyer) visiting for first time" | Transaction list panel below map (seeing actual deals, not just boundaries) | **HIGH** — addressed data-visibility gap |
| Blog | "Reader seeing 19 posts, looking for related content" | Related Posts section with tag-based clustering | **MEDIUM** — real discovery problem at scale |

**Open-ended proactivity variants** (no persona):

| Project | Instruction | Outcome | Fidelity |
|---------|------------|---------|----------|
| Wrapper Monitor | "Can anyone outside find your findings? If not, publish first." | Blog cross-post for discoverability | **MEDIUM** — addressed real problem but not user-persona-driven |
| Factor Dashboard | "Any factor >1σ from mean? Propose if user should care." | Regime alert for MKT-RF -2.2σ | **MEDIUM** — data-driven but not empathy-driven |
| Prompt Patterns | "Propose 1 pattern not on the backlog" | Two novel patterns from incident logs | **HIGH** — but not user-facing (library contributor is the user) |

**Key finding**: Persona probes with specific constraints (time budget, first-visit, domain unfamiliarity) produced proposals that **directly matched the constraint in their solution design**. The Subsidy Radar agent proposed a 3-question quiz because "剛畢業年輕人 on a 30-second bus ride can't read 12 subsidy descriptions." The Realestate agent added a transaction list because "首購族 wants to see actual deals, not just administrative boundaries."

Open-ended proactivity produced valuable proposals, but none explicitly grounded their design in user constraints. The proposals were technically sound but required additional human filtering to check "does this actually reduce friction for [user type]?"

**Anti-pattern validated**: Asking "what would improve UX?" without a persona produced generic suggestions (search bars, export buttons) that already existed in the backlog. The agent optimized for feature completeness, not user empathy.

## Tradeoffs

**Benefit**: Agent proposals are grounded in real user constraints, not technical feasibility. Friction points that would only surface in user testing get caught in autonomous sprints.

**Cost**: Requires upfront persona definition. If the persona is too vague ("a user wants to...") or unconstrained, the pattern degrades to open-ended proactivity.

**Watch out for**:

- **Overfitting to one persona**: The agent optimizes for the probe persona, ignoring other user cohorts. Mitigation: rotate personas across sprints or define 2-3 personas upfront ("new user / power user / time-constrained").

- **Agent proposes without validating assumptions**: Persona-driven proposals feel high-fidelity but may be based on wrong assumptions about what the persona actually wants. Always mark these as hypotheses requiring validation.

- **Proposal noise when persona is too broad**: "A user visiting the site" produces the same generic suggestions as "what should we add?" Constraint specificity is load-bearing.

## Related Patterns

- **Proactivity Injection**: Provides the scaffolding for when to run probes. Persona Empathy Probe defines what to probe for.
- **Bounded Autonomy**: Defines proposal vs action boundaries. Persona probes populate the proposal queue, not the implementation queue.
- **Observer-Actor Separation**: Empathy probe is pure observation — discovering friction. Implementation is a separate phase.

## Meta-Observation

This pattern is itself an instance of **Position Over Wording** applied to proactivity: changing the *frame* from "agent-as-builder" to "agent-as-user-with-constraints" shifts output more than any amount of "think creatively" instructions.

The persona constraint forces empathy by constraining cognition — exactly how real users experience the product.
