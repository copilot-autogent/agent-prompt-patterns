---
title: "Calibrated Confidence Signaling"
category: "prompt-structure"
evidenceLevel: "strong"
summary: "Agents present inferences, partially-evidenced conclusions, and direct observations at the same confidence level — as declarative facts. Consumers cannot distinguish 'I verified this empirically just now' from 'I reasoned this from indirect signals three context windows ago.' Explicit confidence markers — inline in every non-trivial factual claim — close this gap. High-confidence claims name their source; medium claims flag the inference; low or stale claims flag both uncertainty and age."
relatedPatterns: ["empirical-gate-before-persisting-diagnosis", "hypothesis-before-action", "evidence-freshness-decay", "belief-entropy-checkpointing", "observe-resolve-pairing"]
tags: ["confidence", "uncertainty", "calibration", "inference", "trust", "epistemics", "overconfidence", "prompt-structure", "tier:2-standard"]
---

## Problem

Agents present inferences, partially-evidenced conclusions, and direct observations at the same confidence level — as declarative facts. Users and consuming agents cannot distinguish "I verified this empirically just now" from "I reasoned this from indirect signals three context windows ago." Acting on overconfident agent output causes costly errors: wrong sprint kills, incorrect diagnostics persisted to bootstrap files, misleading reports propagated downstream.

The failure mode is structural: language models default to declarative phrasing regardless of underlying epistemic state. Nothing in the output signals "this is a hypothesis" versus "this is a confirmed observation" unless the agent deliberately encodes that distinction.

## Context

This pattern applies at every point where an agent is about to state a factual claim in free-form text — in a response to a user, in a rationale or summary written to memory, or in a comment on a PR or issue. It is most critical when:

- The claim will be consumed by another agent (orchestrator, sprint, scheduled task) and used to make a decision
- The claim will be written to persistent storage (memory, bootstrap files, issue threads) that outlives the current session
- The claim is about system state that could have changed (deployment status, token availability, CI outcome, external data)
- The claim was formed from indirect signals or by reasoning from prior context rather than fresh direct observation

The pattern complements `empirical-gate-before-persisting-diagnosis` (which gates the *write* step) and `hypothesis-before-action` (which gates *actions*). This pattern gates the *phrasing* — it ensures uncertainty is visible in the output even before any gate is applied.

## Solution

### 1. Rate Every Non-Trivial Factual Claim at Output Time

Assign a confidence tier to every claim before expressing it. Three tiers cover most cases:

**High confidence** — directly observed, recently verified, source identifiable:

> "I confirmed the deploy succeeded: the Deploy run for SHA `abc123` shows the `deploy-pages` job concluded `success` at 14:23Z."

**Medium confidence** — reasoned from partial evidence, not directly observed:

> "Based on the error message pattern, I *believe* this is a rate-limit issue — but I haven't confirmed the API response code directly."

**Low confidence** — inferred from indirect signals, or from stale evidence:

> "My working hypothesis is that the token is absent in the subprocess env. This relies on 3-session-old context. Verify by reading `/proc/1/environ` before acting."

The tier names are not required in the output. What is required is that the distinction *appears in the text* — hedging language, sourcing, or an explicit staleness note. ⚠️ **A claim with no qualification will be *read as* high confidence by consumers** — even if the agent's internal epistemic state is lower. Unqualified prose is not permission to omit hedging; it is a description of what consumers will infer. Claims about system state that haven't been directly verified must carry a visible qualifier.

### 2. Never Present an Inference as an Observation

The boundary between observation and inference must appear in the output text, not just be available to the agent internally.

```
# BAD — presents inference as observation
"The subprocess lacks the GITHUB_API_TOKEN."

# GOOD — inference named as inference, with the basis
"I infer the subprocess lacks the GITHUB_API_TOKEN from the 403 response, but I haven't
read /proc/1/environ to confirm. The token could be present and the 403 could reflect
scope restriction on this specific endpoint."
```

The practical test: if a senior engineer read the output cold, would they know which parts are confirmed observations and which are working hypotheses? If not, the output is mis-calibrated.

### 3. Surface the Evidence Basis, Not Just the Conclusion

Including the evidence basis lets the consumer assess confidence independently.

```
# LOW-PROVENANCE — claim only
"CI passed."

# HIGH-PROVENANCE — claim plus verifiable basis
"The Actions run for SHA `abc123` shows the deploy-pages job concluded `success` (job
URL: github.com/…/actions/runs/123/jobs/456)."
```

When the evidence basis is weak or stale, say so: "Based on a run from 4 hours ago — re-verify before concluding CI is currently green."

### 4. Flag Time-Sensitive and Context-Stale Claims

Claims that depend on state that could have changed since it was verified carry an implicit staleness risk. The threshold should be calibrated to state volatility, not raw time or tool-call count: deployment status and token validity can go stale within a single long-running tool call; static code structure may remain valid across many context windows. When in doubt, add an explicit marker:

> "As of my last check [N steps ago], the deploy was in progress. Re-verify before treating this as the current state."

> "This was true at session start. If significant time has passed or another agent has been active, re-read before acting."

The threshold for a staleness flag should be lower for claims about fast-changing state (deployment status, token validity, external API availability) and higher for claims about stable state (static code structure, committed configuration).

### 5. Pair With the Empirical Gate Before Persisting

Before writing any confidence-rated claim that is *inferred or medium/low confidence* to persistent memory or bootstrap files, apply `empirical-gate-before-persisting-diagnosis`: run a falsifying check and upgrade from inferred to confirmed if it passes. Note that even high-confidence claims about volatile external state (deployment status, API availability, token scope) should be re-verified at write time if significant action has occurred since the original observation — evidence that was fresh when formed can be stale by the time you write it to a persistent record. This rule is narrower than rule 1 — it applies only at the *write* step, not to every in-session claim. The phrasing distinction in this pattern makes that gate easier to apply — a claim already marked as an inference is harder to accidentally persist as a fact.

## Anti-patterns

**Narrative fluency over epistemic accuracy**: the agent's output reads smoothly and sounds authoritative. Each claim follows the last without hedges or qualifiers. The result is a coherent narrative that may contain several unverified inferences indistinguishable from observations — and downstream consumers treat the whole narrative as fact.

**Hedging by implication**: the agent knows a claim is uncertain but expects the consumer to infer this from context ("obviously I can't know for sure"). Explicit calibration cannot be implicit. If the uncertainty doesn't appear in the text, it isn't communicated.

**Over-hedging low-stakes claims**: applying uncertainty language uniformly to every claim including trivially verifiable ones ("I *believe* the file exists…") dilutes the signal. Calibrated confidence means reserving explicit uncertainty markers for claims that are *actually uncertain* — claims about external system state, inferences from indirect signals, or conclusions that depend on stale context. A useful boundary: if the claim is about a static, directly-readable fact that cannot change without an explicit local edit (a literal constant in code, a version string in a committed config file), hedging adds noise. If verification requires an external API call, environmental access, or relies on evidence from a prior session or context window, an explicit qualifier is warranted.

**Stale confidence recycling**: an agent forms a high-confidence claim based on a direct observation, then states the same claim five tool-calls later — without re-verifying and without a staleness marker — using the original confidence tier. The confidence tier describes the state of evidence *at the time of the statement*, not at the time of the original observation.

## Evidence

**autogent CONTEXT.md — subprocess token false diagnosis (2026-07-02)**: An agent formed the hypothesis that `GITHUB_API_TOKEN` was absent in subprocess environments and expressed it as a confident causal statement: "GITHUB_API_TOKEN is present in PID1 env but NOT propagated to bash/agent subprocesses." This was written to `CONTEXT.md` (a push-injected file) before the falsifying check — `get_me` from the same subprocess — was run. The claim was later falsified: the reconciler did 17 ProjectV2 board mutations with 0 errors using the same subprocess class. The actual root cause was a 20-minute timeout, not an auth block. The overconfident phrasing caused the wrong diagnosis to be injected into every subsequent sprint agent's system prompt, and a multi-line retraction note is now permanently budgeted in the file. Had the output been phrased as "I *infer* the token is absent in subprocess env from the FORBIDDEN errors — unconfirmed; verify with `get_me` before diagnosing as auth", the retraction would have been unnecessary.

**autogent — sprint kill on false alarm (2026-07-04)**: An agent held two issues as `status:needs-input` gated on a data pipeline blocker. When a notification arrived that appeared consistent with the blocker being cleared, the agent was highly confident the hold was no longer valid — and killed both in-progress sprints without reading the 2-line un-hold comment that would have confirmed whether the specific blocker had actually shipped. The confidence was not marked; the kill action was taken as if the inference were a confirmed observation. Phrasing the inference as "I *believe* the blocker has shipped based on [signal] — but I haven't confirmed the specific issue is closed" would have prompted a verification step before the destructive action.

**General pattern across autogent incidents**: multiple `CONTEXT.md` gotcha entries begin with "DO NOT diagnose X as Y — verify Z before escalating." In each case, the original wrong diagnosis was expressed as a fact. The fix was an empirical check. The compounding cost — retraction notes permanently budgeted in the push file — could have been avoided if the initial inference had been phrased as an inference with an explicit verification step, rather than as an observation.

## Related Patterns

- **Empirical Gate Before Persisting a Causal Diagnosis** — gates the *write* step: before writing any claim to persistent storage, run a falsifying check. This pattern ensures the uncertainty is visible in the output even before the gate is applied.
- **Hypothesis-Before-Action** — gates *interventions*: form and state a hypothesis before acting on it. Together these three patterns cover the full cycle: state uncertainty visibly → don't act on unverified hypotheses → don't persist unverified claims as facts.
- **Evidence Freshness Decay** — models how evidence loses reliability over time and context windows. Provides the framework for when to apply a staleness marker (rule 4 above).
- **Belief-Entropy Checkpointing** — saves state at high-uncertainty junctures. Calibrated confidence signaling is what makes uncertainty *visible* so checkpointing decisions can be made on an accurate picture of what is and isn't known.
- **Observe-Resolve Pairing** — pairs every action with a verifying observation. Calibrated confidence signaling makes those observations legible: if the verifying observation is stated confidently, consumers can distinguish "I verified" from "I assumed it worked."
