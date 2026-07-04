---
title: "Pre-Synthesis Adversarial Self-Critique"
category: "multi-agent"
evidenceLevel: "moderate"
summary: "Multi-model swarms converge prematurely when agents optimize for coherence rather than correctness. Before synthesis, require each agent to produce one adversarial critique of its own primary answer — the strongest argument it is wrong, and what evidence would falsify it. The synthesizer collects and explicitly addresses these critiques rather than averaging them away."
relatedPatterns: ["multi-model-persona-lenses", "model-pool-composition", "convergence-stall-detection"]
tags: ["multi-agent", "multi-model", "adversarial", "self-critique", "synthesis", "swarm", "convergence", "falsification", "verification"]
---

## Problem

Multi-model agent swarms tend toward premature convergence. Each agent affirms the others' proposals rather than stress-testing them. Without a structured challenge requirement, agents optimize for **coherence** (agreeing on a plausible answer) rather than **correctness** (finding the answer that survives scrutiny). The synthesizer inherits a consensus that was never challenged, producing confident-sounding output with unexamined failure modes.

**This is distinct from model diversity and persona diversity.** Even agents with different model families and adversarial personas can all avoid adversarial self-challenge if the protocol doesn't explicitly require it. A Precision agent, an Orthogonal agent, and a Creative agent can each produce a different framing — and all three framings can share the same overlooked assumption about the problem.

**Observed failure modes:**

- Three review agents flag the same obvious risks and all omit the same subtle ones. High inter-agent agreement is read as "high confidence," but it reflects shared blind spots, not genuine validation.
- A synthesis step averages divergent agent outputs into a hedged recommendation. An individual agent's minority objection ("this approach has a correctness failure under concurrent access") is treated as a low-weight minority view and buried.
- An agent identifies a strong counter-argument during its analysis but suppresses it, reasoning that its job is to produce a useful answer, not to undermine it.

The common structure: **there is no protocol step that forces each agent to be wrong about its own answer before the synthesizer sees it**. Synthesis from unchallenged inputs inherits unchallenged assumptions.

## Context

This pattern applies when:

- Multiple agents are run in parallel and their outputs are synthesized (swarm pattern).
- The synthesis is used to drive a consequential decision: architectural choice, risk assessment, merge/no-merge decision, or any output with significant downstream cost if wrong.
- The task admits failure modes that a neutral analysis might overlook — specifically where the most plausible answer has a non-obvious flaw.

It does not apply to:

- Single-agent tasks where there is no synthesis step.
- Enumeration tasks where the goal is breadth (find all cases of X) rather than a single recommended answer.
- Low-stakes tasks where the cost of a wrong answer is negligible.

## Solution

**Add a mandatory `## Self-Critique` section to each agent's system prompt. Collect these critiques alongside primary answers in the synthesizer. Address genuine unresolved risks explicitly; escalate critiques shared across 2+ agents, and treat those shared across 3+ agents as HIGH-confidence risks.**

### Agent system prompt addition

```
After your primary analysis, add a section titled "## Self-Critique":
- State the single strongest argument that your primary answer is WRONG.
- Identify what evidence would falsify your recommendation (be concrete: what observable output, test result, or data point would change your conclusion?).
- If you found no valid counter-argument, explain why — don't skip this section, as "I found no counter-argument" is itself meaningful signal to the synthesizer.
```

The three prompts serve different functions:

| Prompt component | Function |
|---|---|
| "Strongest argument your answer is WRONG" | Forces the agent to adversarially inhabit the opposing position, not just list caveats |
| "What evidence would falsify your recommendation" | Converts a qualitative critique into a testable claim; empty or vague falsifiers indicate weak self-critique |
| "If no counter-argument, explain why" | Prevents skip-by-silence; distinguishes "genuinely no counter-argument found" from "I didn't try" |

### Synthesizer behavior

**Step 1: Process all self-critiques before synthesizing primary answers.**

Because self-critiques appear in the same free-form response as primary answers (as a `## Self-Critique` section), the synthesizer reads them by extracting the section from each agent's full output. The synthesizer should extract case-insensitively and accept common heading variants (`## self-critique`, `**Self-Critique:**`, `### Self-Critique`). Concretely: collect the `## Self-Critique` sections first, form a mental model of the risk landscape, then return to read the full primary analyses against that landscape. This sequencing prevents anchoring — a synthesizer that reads three converging primary answers before the critiques will unconsciously discount the critiques as minority views.

**Step 2: For each critique that points to a genuine unresolved risk, explicitly address it.**

"Addressing" means one of:
- **Refute**: explain why the failure mode identified in the critique doesn't apply (with evidence, not assertion).
- **Mitigate**: acknowledge the risk and state what guard is in place to catch it if it occurs.
- **Escalate**: if neither refutation nor mitigation is available, the critique is an unresolved risk — do not bury it in the synthesis, surface it as a caveat or blocker.

Averaging is not addressing. A synthesis that says "some agents expressed concerns but overall the recommendation is X" has consumed a self-critique without processing it.

**Step 3: Apply escalation thresholds.**

| Condition | Action |
|---|---|
| 1 agent raises a critique (others don't) | Address in synthesis; may proceed if refuted or mitigated |
| 2 agents share a critique | Treat as elevated risk; require explicit refutation or mitigation before proceeding |
| 3+ agents share a similar self-critique | Treat as HIGH-confidence risk; do not override in synthesis without explicit justification |
| Any unresolved critique on a high-stakes / irreversible decision | Escalate to human review rather than synthesizing a recommendation |

**Threshold scaling for small swarms**: The 3-agent threshold assumes a standard 3-lens swarm (Precision/Orthogonal/Integration). For a 2-agent swarm, treat consensus of both agents as HIGH-confidence risk (100% agreement = equivalent signal). For a 4+ agent swarm, keep the 3-agent absolute threshold rather than scaling proportionally, since three independent agents is sufficient evidence regardless of total pool size.

"High-stakes / irreversible" includes: merging to production, deleting data, architectural changes that require coordinated rollout, and any action where the cost of being wrong exceeds the cost of a delay.

**Step 4: Report the critique landscape in synthesis output (recommended; omit when output schema is constrained).**

When the synthesis output format permits it, include a summary of self-critiques collected and how each was resolved. This serves as an audit trail and prevents the pattern from being a paper exercise. Where the downstream consumer requires a constrained output schema (e.g., structured JSON, single-paragraph recommendation), embed the critique resolution as an internal reasoning step and surface only unresolved escalations in the final output:

```
## Critique Resolution

| Agent | Critique summary | Resolution |
|---|---|---|
| Precision | [brief] | [Refuted / Mitigated / ESCALATED] |
| Orthogonal | [brief] | [Refuted / Mitigated / ESCALATED] |
| Creative | [brief] | [Refuted / Mitigated / ESCALATED] |
```

If three agents produce the same critique, merge them into one row marked `[×3 shared — HIGH-confidence risk]`.

### Example: code review swarm

**Without self-critique:** Three agents review a PR. All three flag the missing null check. All three miss the race condition in the cache invalidation logic. Synthesis confidently reports "one issue found."

**With self-critique:**
- Precision agent primary answer: "null check missing on line 42." Self-critique: "My analysis assumes the cache is always accessed sequentially. If there is any concurrent access path, the cache invalidation on line 67 is not safe."
- Orthogonal agent primary answer: "null check missing." Self-critique: "I did not trace all callers of `invalidateCache()`. If called from a background thread, my null-check fix may mask a concurrent access bug."
- Creative agent primary answer: "null check, plus suggest adding a test for edge case X." Self-critique: "I may have over-indexed on the null check. The more dangerous defect could be in paths I didn't fully explore."

Synthesis: two agents (out of three) share a critique about concurrent access in `invalidateCache()`. Elevated risk; synthesizer cannot refute or mitigate without additional analysis. Escalated. Null check noted separately. PR blocked pending concurrent access analysis.

## Calibrating critique quality

Not all self-critiques are equal. Low-quality self-critiques evade the protocol without satisfying it:

| Low-quality pattern | Why it's insufficient | Better version |
|---|---|---|
| "My answer might be wrong in edge cases" | No specific failure mode; unfalsifiable | "If input X contains Y, my recommendation fails because Z" |
| "I am not 100% certain" | Epistemic hedging, not adversarial critique | "The evidence I cited assumes A, which is falsified if B is observed" |
| "A different approach might also work" | Alternative, not critique | "My recommended approach fails if C, which would require switching to approach D" |
| Skipping the section | Silent non-compliance | Any answer in the section is better than none |

The synthesizer should flag low-quality self-critiques as "no genuine self-critique produced" rather than silently discarding them. Agents that produce vague critiques consistently may need stronger prompt language or a persona that explicitly rewards finding their own errors.

## Tradeoffs

**Benefit:** Synthesis inputs are adversarially tested before reaching the synthesizer. Failure modes that would survive unchallenged consensus are surfaced before a decision is made. The critique landscape becomes an audit trail.

**Cost:** Adds one section per agent response (modest token cost). Synthesizer logic is more complex — must process critiques, not just aggregate answers. In the limit, a synthesizer that processes 5 agent critiques may take as long as a 6th agent run.

**Watch out for:**

- **Ritual compliance**: agents produce a Self-Critique section that reads as genuine but is constructed to avoid triggering escalation ("I found no counter-argument"). Monitor for this by checking whether critiques ever cause escalation — a pool that never produces an escalating critique is not adversarially testing.
- **Critique suppression in cooperative fine-tuned models**: some models have strong fine-tuning pressure toward helpfulness and coherence, making it harder to produce adversarial self-critiques. Stronger prompt language may be needed: "Your job in this section is to argue against your own answer as forcefully as possible. Treat this as a debate in which you switch sides."
- **Escalation fatigue**: if the threshold is too low (e.g., any critique escalates), users stop acting on escalations. Set the 3-agent shared-critique threshold as the HIGH-confidence trigger; single-agent critiques are addressed but not automatically blocking.
- **Synthesizer anchoring on critiques**: reading all critiques first (Step 1) is meant to prevent anchor on primary answers, but can create the inverse problem — the synthesizer over-weights concerns identified in critiques. Balance: critiques should raise questions, not predetermine the synthesis conclusion. A well-refuted critique should not carry forward as a risk.

## Evidence

**swarm_agents design pattern** (feature-roadmap: Swarm Convergence Stall Detection): identified that diversity metric (inter-agent response similarity) without an adversarial protocol still allows premature consensus. Swarms with diverse model pools can still converge if no agent is required to challenge its own answer.

**Paper survey recurring front** — "Agent Verification & Self-Criticism" appeared in surveys on 2026-07-01 (Agent Introspection & Reliability), 2026-07-02 (Verification & Trustworthy AI), and 2026-07-03 (Agent Verification & Self-Criticism) as a research front. The research trajectory suggests adversarial self-review as a mechanism for reducing confident-incorrect synthesis in multi-agent systems, though controlled empirical comparisons remain in progress.

**Convergence stall detection observations** (autogent incident data): swarm-based PR reviews consistently surfaced the same visible issues while missing non-obvious ones. Post-hoc analysis of agent outputs in several cases found that individual agents had internally recognized a non-obvious risk but did not surface it in their primary analysis. A mandatory self-critique section would have surfaced these buried recognitions.

**Evidence level: moderate** — pattern is theoretically grounded and supported by recurring observations across autogent sprint operations. Not yet formally instrumented across a statistically significant set of swarm runs; elevation to "strong" after controlled comparison of swarm outputs with/without self-critique protocol.

## Related Patterns

- **[Multi-Model Persona Lenses](/agent-prompt-patterns/patterns/multi-model-persona-lenses)** — persona lenses ensure diverse *perspectives* enter the swarm; pre-synthesis self-critique ensures each perspective is adversarially tested *before* synthesis. The two patterns compose: diverse-persona agents that also produce self-critiques maximize both coverage and stress-testing.
- **[Model Pool Composition](/agent-prompt-patterns/patterns/model-pool-composition)** — pool diversity ensures agents have different blind spots; self-critique forces each agent to probe its own blind spots explicitly. Pool diversity without self-critique reduces the chance that all agents share a blind spot; self-critique catches blind spots even when they do overlap.
- **[Convergence Stall Detection](/agent-prompt-patterns/patterns/convergence-stall-detection)** — convergence stall detection identifies when a single agent is looping without progress; pre-synthesis self-critique prevents the *swarm-level* convergence that causes unchallenged consensus from reaching the synthesizer. Complementary scopes: stall detection is within-run, self-critique is across-agent-within-swarm.
