---
title: "Empirical Gate Before Persisting a Causal Diagnosis"
category: "memory-management"
evidenceLevel: "strong"
summary: "Agents observing unexpected failures form quick causal hypotheses and immediately record them in persistent memory or push-injected context files. When the hypothesis is wrong, the error propagates to every future session. Before writing any causal claim to a push-injected file or persistent memory, run a minimum falsification check: name the cause, identify at least one distinguishing observable, run the check, and only upgrade to fact after confirmation. Unconfirmed diagnoses must be tagged explicitly."
relatedPatterns: ["hypothesis-before-action", "constraint-falsification", "memory-read-before-write", "belief-entropy-checkpointing"]
tags: ["memory", "diagnosis", "falsification", "context", "push-files", "causal-claim", "empirical", "debugging", "tier:2-standard"]
---

## Problem

When agents encounter unexpected failures, they form causal hypotheses and immediately record them in persistent memory or push-injected context files (e.g., `CONTEXT.md`). If the hypothesis is wrong, the error propagates to every future session — injected as a false assumption into every sprint agent's system prompt. Correcting a wrong push-file entry requires an explicit retraction note that wastes context budget indefinitely.

The compounding cost: **observation → quick hypothesis → write to CONTEXT.md (as fact) → hypothesis falsified → retraction note added alongside the original → both persist**, costing 4–8 lines of context per mistake. In systems with many concurrent sprints, a single wrong causal claim in a push file can mislead dozens of agents before it is corrected.

This failure mode is distinct from the in-session debugging problem (see `hypothesis-before-action`). Here the harm is not a bad fix — it is **bad institutional memory** that outlives the session that produced it.

## Context

This pattern applies specifically to the *recording step*: the moment an agent is about to write a causal claim to a file or memory system that will outlive the current session. It is most important when writing to:

- **Push-injected files** (`CONTEXT.md`, `PLAYBOOK.md`, or any bootstrap file loaded into every agent's system prompt)
- **Persistent memory topics** that will be recalled in future sessions
- **Issue or PR comments** that will inform future sprint agents reading that thread
- **Architecture decision records** or runbooks that treat claims as operational facts

It complements `hypothesis-before-action` (which gates *actions*) and `constraint-falsification` (which targets latent assumptions). This pattern gates the *write* itself.

## Solution

### The Falsification Gate

Before writing any causal claim to persistent storage, apply four steps:

```
1. NAME THE CAUSE
   State the claim explicitly: "X caused Y."
   Example: "GITHUB_API_TOKEN is absent in subprocess env → board-sync is broken (FORBIDDEN)."

2. IDENTIFY A DISTINGUISHING OBSERVABLE
   Find at least one observable that separates your proposed cause from the most
   plausible alternative.
   Example: "If the token is absent, ALL API calls from the subprocess should fail —
             but `get_me` succeeded in the same subprocess. That falsifies the hypothesis."

3. RUN THE CHECK
   Execute the observable test before writing. Three outcomes:
   - **Confirmed**: the observable matches the hypothesis → proceed to step 4.
   - **Falsified**: the observable contradicts the hypothesis → update your model, return to step 1 with a new hypothesis. Do not write the falsified claim.
   - **Inconclusive**: the check cannot distinguish the proposed cause from alternatives → write only the symptom, tagged [UNCONFIRMED: open question — <symptom observed, cause unknown>].

4. UPGRADE TO FACT ONLY AFTER CONFIRMATION
   Once the observable confirms the hypothesis, write the causal claim to the persistent
   file with the confirming evidence noted alongside it.
```

### Bar by Storage Type

The higher the reach of the storage, the higher the bar before writing:

| Storage type | Reach | Required bar |
|---|---|---|
| Session notes / scratch | Current session only | Low — hypothesis-as-hypothesis is fine |
| Persistent memory topic | Recalled on demand, scoped | Moderate — flag unconfirmed claims |
| ADR / runbook | Future contributors reading that document | Moderate — same as memory topic: flag unconfirmed, record symptom vs cause |
| Issue / PR comment | Future sprint agents reading that thread | Moderate — distinguish symptom from cause; avoid including auth/credential details in public threads |
| `CONTEXT.md` / `PLAYBOOK.md` | Every future session, every sprint agent | **Highest — delay the write until confirmed. If confirmation is impossible, do not write at all; use a pull-only memory topic instead.** |

### Handling Unconfirmed Hypotheses

When you cannot run a falsifying check (no access to the environment, no reproducer available):

- **For push-injected files** (`CONTEXT.md`, `PLAYBOOK.md`): do not write the unconfirmed claim at all. Instead, write only the observable symptom to a **pull-only memory topic** (where it is recalled on demand, not injected into every session). This avoids push-contaminating every future sprint agent with a speculative diagnosis.
- **For memory topics and issue/PR comments**: recording with `[UNCONFIRMED]` is acceptable — agents query these on demand rather than receiving them unconditionally.

The `[UNCONFIRMED]` tag format:

```
# GOOD — records the symptom and open question:
[UNCONFIRMED: observed FORBIDDEN errors from board-sync subprocess. Cause unknown —
possible token scope, possible API rate-limit. Check with: run get_me from the same
subprocess; if it succeeds, token presence is confirmed, but scope-specific permission
errors remain possible — check the specific endpoint's required scopes separately.]

# BAD — asserts causation before falsification:
GITHUB_API_TOKEN absent in subprocess env → board-sync broken (FORBIDDEN errors).
```

The `[UNCONFIRMED]` tag is a **convention**, not a machine-enforced schema. Retrieval and bootstrap systems surface tagged entries alongside confirmed facts — the tag only works if agents reading the file treat it as a gate. When recording an `[UNCONFIRMED]` entry, always include an explicit verification step ("check with: …") so the convention has teeth. **For this reason, `[UNCONFIRMED]` is most effective in pull-only storage** (memory topics, issue threads) where an agent deliberately retrieves it before acting; it is least reliable in push-injected files where every sprint agent receives it unconditionally.

### Retractions Cost More Than Getting It Right Once

A confirmed wrong entry in `CONTEXT.md` cannot be safely deleted without context — future agents may have already anchored on it. The options, in order of preference:

1. **Replace and archive (preferred for push-injected files)**: rewrite the entry with the correct causal chain and archive the old one to a **pull-only** memory topic (e.g., `context-archive-YYYY`). Pull-only topics are recalled on demand — they do not inject into every session — so the archived wrong claim cannot re-contaminate future agents unless they explicitly recall it. This keeps the push file clean while preserving the audit trail.

2. **Retraction note (fallback when replacement is ambiguous)**: append a retraction immediately after the original entry:
   > ✅ **Correction (date)**: the above was falsified empirically — [what actually happened].
   But be aware: both the wrong claim and the retraction note now persist in the file, costing 4–8 lines of context indefinitely, and some agents will anchor on whichever they read first.

**Concurrent writers**: in multi-sprint systems, multiple agents may independently form and "confirm" conflicting diagnoses about the same symptom. Before writing a confirmed causal claim to a shared push file, check whether another agent has already recorded a diagnosis for the same symptom — conflicting confirmed claims are harder to resolve than a single wrong claim. Note that no serialization guarantee exists: two agents can each independently pass the falsification gate and write conflicting claims simultaneously. The pattern reduces the probability of this (fewer wrong claims in total), but does not eliminate the race; shared push-file hygiene requires periodic human review in high-throughput sprint systems.

The only way to avoid all these costs is to not write the wrong claim in the first place.

## Anti-patterns

**Narrative momentum**: the debugging session is generating a coherent story. Each new observation seems to confirm the emerging hypothesis. The agent writes it to CONTEXT.md to "capture the insight." The story was mostly right — except for the causal link, which was not tested. One wrong causal link in a mostly-correct narrative can produce systematically wrong behavior in all future agents who act on it.

**Urgency as a bypass**: the fix is time-sensitive, so the agent skips the falsification check and writes the causal claim immediately after forming it. When the failure recurs, future agents anchor on the (possibly wrong) prior causal claim and bias their debugging toward that diagnosis.

**Falsification by consistency**: "Everything I observed is consistent with X causing Y, therefore X caused Y." Consistency is not confirmation. The falsification gate requires an observable that *would distinguish* X from the most plausible alternative — not one that merely fits X.

**Retraction exhaustion**: after a pattern of wrong causal claims and their corrections, the push file contains so many `⚠️ Correction` and `✅ Correction` notes that agents cannot parse which version to trust. This is a symptom of repeatedly skipping the falsification gate.

## Evidence

**autogent CONTEXT.md — subprocess token diagnosis (2026-07-02)**: A causal claim was written to `CONTEXT.md` stating that `GITHUB_API_TOKEN` was absent in subprocess environments, causing board-sync to fail with FORBIDDEN errors. The hypothesis was weakened the same day by a data point showing a reconciler run — using the same subprocess class — successfully executed 17 ProjectV2 board mutations with 0 errors. This does not directly falsify token absence in the *specific* failing invocation (env propagation can vary per invocation), but it is strongly inconsistent with a class-wide token absence hypothesis. The actual root cause was identified as a 20-minute latency timeout during a bulk board read (838 items, 9 pages), not an auth block. The falsifying check that should have been run first: `get_me` from the same subprocess environment — if it succeeds, token presence is confirmed (ruling out absence); FORBIDDEN errors on a specific endpoint then point to scope or rate-limiting, not token absence. The retraction note (`✅ Correction`) now costs 3–4 lines of `CONTEXT.md` budget indefinitely.

**Pattern**: The check that would have prevented this — `get_me` from the same subprocess — is a one-line falsifying observable that rules out token *absence*. It does not rule out endpoint-specific scope restrictions or rate-limiting on write endpoints (a token can be present and pass `get_me` but lack write permission on ProjectV2 mutations). A more complete falsification would chain: (1) `get_me` → token present; (2) a minimal ProjectV2 *write* mutation (e.g., a no-op field update) → write scope confirmed. The broader lesson is that a falsifying observable must target the *specific* claim, not just a superordinate property. The falsification gate was the missing step; `get_me` was the right first check, but the diagnosis should have listed scope as a remaining open question rather than treating token presence as full confirmation of "auth not the cause."

**General principle**: errors in push-injected files are not corrected by editing — they are corrected by retractions that compound the original cost. The asymmetry between the cost of getting it right once versus the cost of a permanent retraction note is what makes the falsification gate worth its friction even under time pressure.

## Related Patterns

- **Hypothesis-Before-Action** — gates *interventions*; this pattern gates *records*. Together they cover the full debugging cycle: don't act on an untested hypothesis, don't record an untested hypothesis as fact.
- **Constraint Falsification** — applies falsification to latent operational assumptions ("I assume the service is stateless"). Complementary in scope: where Constraint Falsification audits existing assumptions, this pattern prevents new false assumptions from entering the record.
- **Memory Read-Before-Write** — ensures an agent reads the current memory state before overwriting it. This pattern adds: *falsify the causal claim before writing it at all*.
- **Belief-Entropy Checkpointing** — monitors uncertainty about task state over time; surfaces stagnant or increasing entropy as a signal to re-examine assumptions. The `[UNCONFIRMED]` tag in this pattern feeds entropy tracking: an unconfirmed causal claim raises uncertainty rather than resolving it.
