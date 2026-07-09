---
title: "Operator-Blocked Escalation Ladder"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "When an agent-filed issue is blocked on human input, a tiered escalation ladder with pre-declared defaults and explicit deadlines prevents indefinite stalls. Day 0: file with defaults. Day 3: auto-decide threshold comment. Day 7: act on defaults or close as not_planned. Never let needs-input items age beyond 14 days without an escalation comment."
relatedPatterns: ["decision-ownership", "bounded-autonomy", "uncertainty-gated-irreversible-action"]
tags: ["escalation", "needs-input", "autonomy", "stall-prevention", "defaults", "deadlines", "single-operator", "pipeline"]
---

## Problem

An agent identifies a decision that requires human input — an architecture choice, a product direction question, a kill-or-pivot call. It files an issue with `status:needs-input` and moves on. Three days later, the issue is unchanged. Two weeks later, it's still there. The agent queries it again, sees `needs-input`, and does nothing — there's no trigger to act differently.

This is **blocked-pipeline stagnation**: the autonomous loop has a hard dependency on human input with no time-bounded fallback. In a single-operator system, "human busy" means the entire work stream behind that decision silently idles.

Three specific failure modes:

**Defaults without publication**: The agent has a sensible default in mind but never states it. When the operator finally reads the issue, they don't know what the agent would have done — so they can't quickly ratify or override. Every review requires a full re-read.

**No escalation trigger**: The issue sits in `needs-input` state indefinitely. The autonomous pipeline doesn't have a mechanism to re-surface the decision cost after a threshold. "Needs input" becomes "forgotten."

**Soft holds that don't hold**: Writing "recommend holding this until decision is made" in a comment or memory topic does nothing to stop crons from graduating the issue and dispatching a sprint. The hold is advisory-only and invisible to scheduler logic.

**Real-world cost**: A 5-project audit found 4 had `needs-input` items aged > 3 days, with the oldest at 36 days (ai-security-blog #30). In subsidy-radar #23, a 24-day stall blocked an entire feature line. In subsidy-radar #117, the agent wrote an auto-decide date in the issue body — but that date was never mechanically enforced and the item was still stalled 2 days past it.

## Context

This pattern applies when:
- An agent operates in a continuous pipeline (scheduled crons, issue-dispatched sprints)
- The human operator is the sole decision-maker but is not always present
- Decisions have varying stakes — some can safely proceed with defaults, others require explicit sign-off

The core tension: the agent cannot act without a decision, and the human cannot stay perpetually available to unblock every decision. An escalation ladder converts a hard dependency into a time-bounded one: after N days, either the operator acted, or the agent acts on pre-declared defaults.

**What this is not**:
- It does not eliminate the need for human judgment on high-stakes decisions
- It does not give agents license to proceed when a genuine blocker remains uncleared
- It does not replace asking — it schedules the consequence of not responding

## Solution

**Structure every `needs-input` issue with three elements upfront:**

1. **The question** — one specific decision, not a collection of related questions
2. **Pre-declared defaults** — what the agent will do if no response is received
3. **Auto-decide date** — explicit calendar date when the default kicks in (default: 3 days for low-stakes, 7 days for high-stakes)

**The escalation ladder:**

| Day | Action |
|-----|--------|
| Day 0 | File issue with `status:needs-input` + pre-declared defaults + auto-decide date in the body |
| Day 3 (or auto-decide date) | Post comment: "Auto-decide threshold reached. No objection by EOD → **[low/medium-stakes]** sprint proceeds with: [explicit defaults]; **[high-stakes]** will close as not_planned. Reopen or comment to override." |
| Day 7 | **Low/medium-stakes with safe defaults**: remove `status:needs-input`, apply `status:draft`, post "Proceeding with defaults: [list]". **High-stakes (architecture/kill-pivot)**: close `not_planned` with "Reopen when ready to decide." |
| Never | Let `needs-input` age > 14 days without an escalation comment or closure |

**Pre-declared defaults are non-negotiable**: "Proceeding unless you object" with no stated plan is ambiguity, not a default. A real default: "If no objection, will implement with difficulty tier fixed at current user median, not adaptive." The operator must be able to ratify or override in one sentence; that's only possible if they know exactly what they're ratifying.

**Status label transitions are exclusive**: when transitioning an issue out of `needs-input`, always remove the old label before applying the new one. An issue carrying both `status:needs-input` and `status:draft` will match `needs-input` sweepers and `draft` dispatchers simultaneously — causing double processing. Remove `status:needs-input` first, then apply the new status.

**Soft holds require enforcement**: Writing a recommendation to hold something in memory or a comment doesn't stop crons. To actually gate work: (a) apply a `status:blocked` or `hold` label that scheduler crons filter out, (b) close the issue with a note to reopen after the decision, or (c) pause the specific cron task. Advisory-only holds evaporate at session end.

**Stake classification:**

| Stakes | Characteristics | Default behavior at Day 7 |
|--------|----------------|--------------------------|
| Low | Reversible, no user-facing behavior change, safe defaults obvious | Proceed with defaults |
| Medium | Some user-facing impact, but contained and fixable | Proceed with defaults + prominent notification |
| High | Architecture, product direction, kill/pivot, irreversible | Close `not_planned` — force explicit reopen |

**Scheduling the escalation**: File a `once` task or cron check timed to the auto-decide date. A date in the issue body is not mechanically enforced — something must query it and act. Options: (a) a `once` task scheduled at filing time (preferred — fires exactly once, no idempotency risk); (b) a daily `needs-input` sweeper that reads the explicit `auto-decide:` field from the issue body rather than `updated_at` age (avoid `updated_at`: adding an escalation comment resets it and can suppress the next check). Whichever mechanism you use, guard against duplicate actions with a state check before acting: "has an escalation comment already been posted?" before posting another.

## Evidence

**subsidy-radar #117 (2026-07-04)**: Agent wrote an `auto-decide: 2026-07-04` field in the issue body. The date passed. Two days later, still stalled — no comment, no enforcement. The date in the body had no mechanical effect because nothing queried it. A scheduled `once` task or sweeper cron would have enforced the deadline.

**subsidy-radar #23 (24-day stall)**: A `needs-input` issue with no defaults and no auto-decide date. Filed, then queried in future sessions, never acted on. The agent found it unchanged each time and did nothing because there was no escalation trigger. Closed manually after backlog audit.

**ai-security-blog #30 (36-day stall)**: A higher-stakes architecture question with no ladder. Operator didn't surface it until a full pipeline review. 36 days of pipeline work completed around it; the decision was eventually made with no context from the original filing session.

**CONTEXT.md HOLD gotcha**: Documented directly: "A memo-only 'HOLD' does NOT stop autonomous crons — soft holds are unenforced. To actually gate work, use an ENFORCEABLE mechanism." The pattern crystallizes the lesson: a decision intent in memory or a comment is not a gate — only a label, a closure, or a cron-pause is.

**5-project audit**: 4 of 5 surveyed side projects had `needs-input` items aged > 3 days. None had auto-decide comments or explicit defaults. All 4 had downstream work that was implicitly blocked.

## Tradeoffs

**Benefit**: Converts indefinite human-dependency into a time-bounded one. Operators who respond quickly get their decision honored; operators who don't respond get a sensible default applied with notification. The pipeline unblocks.

**Cost**: Risk of acting on items where the operator had strong opinions but didn't read the issue in time. Mitigated by: (a) pre-declaring defaults explicitly so operators can scan quickly, (b) using a higher-stakes classification (Day 7 → close, not proceed) for consequential decisions, (c) the escalation comment at Day 3 that serves as a second notification.

**Watch out for**:
- Escalating stake classification downward to avoid asking: if a decision genuinely requires the operator's specific knowledge or authority, the ladder doesn't substitute for getting that input. Close `not_planned` rather than proceeding with a fake "default."
- Auto-decide date inflation: setting a 30-day auto-decide date is not escalation — it's deferral with extra steps. Default: 3 days for low-stakes, 7 days for high-stakes, 14 days maximum.
- Proceeding with defaults and not logging what changed: the escalation comment must state the specific defaults applied, not just "proceeded." Future sessions need to be able to reconstruct what happened without re-reading the full issue thread.
- Using the escalation ladder for ongoing disagreements rather than genuine non-response: if an operator has explicitly said "wait on this," that's not non-response. The ladder applies only when there has been genuine silence.

## Related Patterns

- **[Decision Ownership](/agent-prompt-patterns/patterns/decision-ownership)** — decision ownership clarifies who owns a decision and when to act without asking; the escalation ladder covers what happens when that owner is unresponsive across sessions
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — bounded autonomy defines the scope of what an agent can do unilaterally; the escalation ladder defines what happens when an item falls outside that scope and the operator is unavailable
- **[Uncertainty-Gated Irreversible Action](/agent-prompt-patterns/patterns/uncertainty-gated-irreversible-action)** — uncertainty gating prevents acting under epistemic uncertainty; the escalation ladder handles temporal uncertainty (operator response timing), not epistemic uncertainty
