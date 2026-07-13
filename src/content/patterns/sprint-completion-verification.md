---
title: "Sprint Completion Verification"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Sprint agents produce confident prose completion summaries, but these summaries describe intended or attempted state — not confirmed actual state. When a sprint exhausts its time budget after the final review round, it may post a summary describing a merge or close without having executed it. Verify artifact state via structured API queries before acknowledging completion; never rely on prose summaries or thread logs alone."
relatedPatterns: ["side-effect-verification", "dead-sprint-recovery", "duplicate-agent-spawn-prevention", "workspace-per-sprint-isolation", "evidence-freshness-decay", "client-rendered-deploy-verification", "pre-destruction-state-revalidation", "dependent-sweep-before-delete"]
tags: ["multi-agent", "verification", "sprint", "completion", "pr-merge", "reliability", "state-verification", "overclaiming"]
---

## Problem

A sprint agent posts a detailed completion summary. The prose is confident: “PR #N is merged and ready for deploy.” The reviewer acknowledges. Twenty-four hours later, the PR is still open with `merged: false`.

This failure mode has three compounding causes:

**Natural language describes intent, not outcome.** An agent composing a summary draws on the same representations it used when planning the action. If the merge was the intended final step, the summary describes it as accomplished — regardless of whether the tool call executed. The summary is written from the agent’s internal model of the world, not from a post-hoc state query.

**Turn exhaustion at the finish line.** Long sprints — those that complete 3 review rounds, push refinements, and then attempt a final merge — tend to exhaust their turn or time budget in the final phase. The sprint has done the substantive work, posted the summary describing the intended outcome, then timed out before the last action executed. The completion message and the absence of completion are temporally adjacent and easy to conflate.

**Thread logs are insufficient as evidence.** Reviewers checking a sprint thread see tool calls for code review, test runs, and comment posts. The absence of a final merge tool call is not prominent — it requires scanning a long thread looking for a specific missing entry rather than a present one. Human reviewers are biased toward noticing what is there.

## Context

This pattern applies whenever a sprint agent’s completion claim involves an irreversible external action:

- **PR-based sprints**: completion means `merged: true` at the version control platform
- **Issue-based sprints**: completion means `state: "closed"` at the issue tracker
- **Deployment sprints**: completion means the service is responding correctly at its endpoint
- **Data pipeline sprints**: completion means the output dataset exists with the expected row count and freshness timestamp

The pattern is most critical when:

- The sprint runtime is abnormally long relative to sibling sprints on the same project (>2× typical duration signals turn exhaustion near completion)
- The sprint was auto-spawned with no human oversight during the run
- The completion is a prerequisite for a follow-on task (deploy, release, dependent feature)

The pattern does NOT apply when the “completion” action is idempotent or reversible — if a sprint claims to have written a file and the file can be re-written if wrong, the verification cost may exceed the correction cost. Prioritize verification for irreversible actions (merges, closes, external API mutations) where an undetected miss has lasting consequences.

## Solution

**Treat the artifact state query as the final step of every sprint review, not as an optional audit.**

**For pull-request-based sprints:**

After receiving a completion notification, query the pull request directly:

```
GET /repos/{owner}/{repo}/pulls/{pull_number}
```

Confirm:
- `merged` is `true` (not just `state === "closed"` — a PR can be closed without merging)
- `merged_at` timestamp is within the sprint’s runtime window (recent merge, not a stale PR from a previous cycle)

If either check fails, treat the sprint as potentially incomplete (see supervisor flow below for how to proceed).

**For issue-based sprints:**

Query the issue directly:

```
GET /repos/{owner}/{repo}/issues/{issue_number}
```

Confirm:
- `state` is `"closed"`
- `closed_at` is recent (within the sprint’s runtime window, not a stale close from a prior cycle)

Then verify the close was caused by the expected sprint’s pull request — another actor or unrelated PR could have closed the issue independently. Query the issue’s event timeline and look for a close event that references the expected pull request. The exact API shape and field names vary by version control platform; the key assertion is that the closing event links to the sprint’s PR, not to an unrelated action. If the close event cannot be matched to the expected PR, treat the completion as unconfirmed.

Also check `state_reason` if the platform exposes it: a `"not_planned"` or rejected close satisfies `state === "closed"` but indicates the work was declined, not completed. Only `state_reason === "completed"` (or the platform’s equivalent resolved/done reason) confirms successful sprint completion.

**For supervisor agents (automated verification):**

```
After sprint completion notification:
1. Parse completion message for pull request and issue references (PR numbers, issue URLs)
   — If parsing yields no references, fall back to querying open PRs/issues by
     the sprint’s issue number (use issue number as discriminator in branch/PR title)
2. For each reference, query the version control API for current state
3. Compare API response fields against the claimed completion state
4. If mismatch detected:
   a. Re-query after a short delay (5–10s) to rule out stale cache
   b. Check whether the sprint agent is still live (recent activity in its thread)
      — if still live, wait for its natural completion before acting
      — if confirmed dead (no recent activity, session timed out), proceed to recovery
   c. Check whether the artifact (branch, commits) exists and is green
      — green artifact → apply [Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery),
        which includes conflict-checking, branch-protection requirements, and CI verification
        before attempting to merge; do not merge directly from this flow
      — no artifact → log as dropped work, schedule a re-sprint
5. Only acknowledge completion after all state checks pass
```

**For sprint prompts (prevention):**

Add an explicit final-verification step before posting the completion summary:

```
Before posting your completion summary:
1. Query the pull request / issue via the API and confirm its state matches what you are about to claim
2. If the confirmation check fails, do not claim success — include the actual state and what step failed
3. Never use “merged”, “closed”, or “shipped” in your summary unless the API response confirms it
```

**Detection heuristics for retrospective triage:**

When reviewing a sprint completion message without real-time supervision, three signals correlate with unconfirmed completion:

1. **Runtime outlier**: Sprint duration >2× the median for that project and task type
2. **Missing terminal action**: Thread log ends with a comment or issue update, not a merge or close tool call
3. **Summary describes future intent**: Phrases like “ready for deploy”, “is now merged”, or “has been closed” without a preceding API confirmation step in the thread

Any one signal warrants a direct API check. All three together make an unconfirmed completion highly probable.

## Evidence

**Production incident: Sprint #34 (2026-06-19)**

A sprint agent completed 3 review rounds on a CLI monitoring tool feature. Runtime: 36 minutes — approximately 3× the median for that project’s sprints. The sprint posted a completion summary: “Done. PR #38 is merged and ready for deploy.”

Direct API inspection showed:
- `merged: false`
- `state: "open"` (the sprint had posted the completion summary but not executed the merge call)
- Thread’s last two tool calls: `issue_write` + `add_issue_comment` — the merge call was absent

The PR had been open for 24 hours before manual inspection caught the mismatch. The fix was a direct merge call taking under 60 seconds. Total latency added by the missed verification: 24 hours.

Root cause reconstruction: The sprint completed its third review round and began the wrap-up sequence — posted the review summary comment, updated the issue body, composed the completion message — and exhausted its turn budget before reaching the merge call. The completion message was written from the intended final state, not from a post-merge state query.

**Generalization across artifact types:**

The same “intent vs. outcome” gap appears across all agent-driven external actions, not just PR merges:

- **Batch processors**: An agent claiming “processed 5,000 records” before confirming via `SELECT COUNT(*)` on the output table will miss partial writes or failed flushes
- **Data pipeline agents**: An “ETL complete” summary posted before polling the output table’s freshness timestamp will not catch pipelines that failed mid-run and left stale data
- **Deployment agents**: A “service restarted” claim made from a successful `restart` command exit code, rather than from a successful health endpoint poll, will not catch cases where the service started and immediately crashed

In each case, the structured artifact query (row count, freshness timestamp, health endpoint response) is the ground truth. The agent’s summary is a description of intent.

## Tradeoffs

**Benefit**: Unconfirmed completions surface in seconds (one API call) rather than hours or days. The cost of the verification step is negligible against the cost of downstream confusion, missed deployments, or re-sprint work.

**Cost**: For high-volume pipelines where every sprint produces a notification, requiring a verification query per completion adds API call volume. This is almost always acceptable — at any reasonable sprint volume, the marginal API cost is trivial compared to the operational cost of undetected missed completions.

**Watch out for:**

- **Verification using the same tool that failed**: Do not verify a merge by calling the merge tool again — call the read endpoint instead. Verification must use a different code path than the original action.
- **Stale cached state**: Some version control platform APIs cache resource state briefly. If a merge literally just completed, a query 100ms later may return stale `merged: false`. In practice this is rare, but if a query returns a surprising result, wait a few seconds and re-query before concluding the action failed.
- **Closed ≠ Merged**: A pull request can be closed without merging (rejected, duplicate, superseded). Check `merged: true` specifically, not `state: "closed"`. This distinction is the most common misread in sprint verification logs.

## Related Patterns

- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the foundational principle: for any operation whose success criterion is a change in the world, verify via the observable outcome, not the return value or summary prose; Sprint Completion Verification applies this principle specifically to the sprint lifecycle endpoint
- **[Dead Sprint Recovery](/agent-prompt-patterns/patterns/dead-sprint-recovery)** — the recovery procedure when verification fails and the sprint is confirmed incomplete but left an artifact; verification is what triggers the recovery decision
- **[Duplicate Agent Spawn Prevention](/agent-prompt-patterns/patterns/duplicate-agent-spawn-prevention)** — prevents the wrong response to a failed verification (spawning a replacement when the original is still live); verify artifact state before spawning any replacement
- **[Workspace-per-Sprint Isolation](/agent-prompt-patterns/patterns/workspace-per-sprint-isolation)** — addresses the related problem of artifact state corruption from concurrent sprints sharing a working directory; both patterns strengthen multi-agent reliability via explicit state checks rather than prose coordination
- **[Client-Rendered Deploy Verification](/agent-prompt-patterns/patterns/client-rendered-deploy-verification)** — the deploy-verification complement: for Astro/SPA sites, confirms what’s actually rendering in the browser after a sprint’s deploy step, not just that the HTML is served
