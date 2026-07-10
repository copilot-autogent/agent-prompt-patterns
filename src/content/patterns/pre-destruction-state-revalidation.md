---
title: "Pre-Destruction State Revalidation"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Before executing any destructive action (killing an agent, closing an issue, reverting a PR, deleting a branch), re-fetch the current external state from the authoritative source rather than relying on the in-context observation that triggered the alarm. The in-context state is a snapshot — it can be stale by minutes or hours. Two confirmed incidents where agents killed valid sprints or prepared unnecessary recovery work because a timeout notification or cached label pre-dated an already-completed merge. Rule: read-then-act, not notify-then-act."
relatedPatterns: ["uncertainty-gated-irreversible-action", "observe-resolve-pairing", "dead-sprint-recovery", "verification-before-completion", "sprint-completion-verification"]
tags: ["destructive-action", "state-revalidation", "stale-state", "read-before-destroy", "sprint-recovery", "agent-autonomy", "irreversible-action", "freshness-check"]
---

## Problem

An agent prepares a destructive action — kill an agent session, close an issue, revert a PR, delete a branch — based on its current in-context understanding of system state. That state was observed earlier in the session, or derived from a completion notification, and may have changed since. The destructive action fires on a stale snapshot, producing wasted motion, data loss, or a duplicated-work regression.

The "cached observation" failure modes:

- A `❌ failed: Timeout` completion notification arrives → agent prepares recovery → the sprint had already merged before failing; the timeout was post-merge bash cleanup
- An issue is "held" in-context → agent kills a sprint dispatched against it → the hold was lifted by an un-hold comment the agent didn't read
- A PR appears "incomplete WIP" → agent closes it → the final commits arrived during the review window
- A deploy appears "not published" → agent reverts → the deployment was just slow to propagate

The key failure mechanism: notifications and cached observations are *instantaneous snapshots*, not live state. In a concurrent system where other agents, crons, and external events continuously modify state, a snapshot's validity decays from the moment it is taken.

## Context

This pattern applies to any agent action that is irreversible or costly to undo:

- **Sprint kill / `stop_agent`**: Terminates a running agent session — cannot restart mid-flight work
- **Issue close**: Closes a GitHub issue — may suppress re-dispatch by sprint supervisors
- **PR close/revert**: Closes or reverts a pull request — discards or undoes work that may have been correct
- **Branch delete**: Removes a git branch — destroys commit history not yet merged
- **File delete or data purge**: Removes artifacts that may still be needed

It does NOT apply to idempotent, reversible, or read-only operations.

## Solution

Before any irreversible action, add an explicit re-fetch step to validate live state.

### Step 1 — Identify the destructive action and its target

Name the action type and the specific target identifier (session ID, issue number, PR number, branch name, file path). Do not proceed until this is explicit — the re-fetch in Step 2 requires knowing exactly what to query.

### Step 2 — Re-fetch current state from the authoritative source

Choose the re-fetch tool based on the action type:

| Destructive Action | Authoritative Source | Re-fetch Tool |
|---|---|---|
| Kill sprint / stop agent | GitHub: issue state + open PRs | `issue_read method=get` → check `state` and `labels`; `pull_request_read method=get` → check `merged` |
| Close or reopen issue | GitHub: issue comments | `issue_read method=get_comments` → read most recent comments for un-hold or un-block signals |
| Revert or close PR | GitHub: PR merge status | `pull_request_read method=get` → confirm `merged: true`/`false` and review last commit timestamp |
| Delete branch | GitHub: branch commit history | `list_commits` → check for new commits since last observation |
| Other destructive action | Depends on target | Re-fetch from the canonical source that owns that target's state |

**Timing rule**: The re-fetch must happen *immediately before* the destructive action — not minutes earlier during the diagnostic phase. State can change between your diagnostic read and your action.

### Step 3 — Compare fresh state against the trigger condition

Ask: does the freshly-fetched state still justify the destructive action?

**If YES — state still warrants the action**: Proceed, and reference the fresh observation in the action's rationale. Example: "Killing sprint: `issue_read` at HH:MM confirms `state: open`, no un-hold comments, no linked merged PR."

**If NO — state has changed**: Abort the destructive action. Log the stale-state discrepancy explicitly: "Trigger: `❌ Timeout` notification. Fresh read: `pull_request_read` shows `merged: true` at 20:13Z. Aborting recovery — sprint already completed." Update the in-context model to reflect actual state.

### Step 4 — One re-fetch is enough

Do not loop or poll. This is a point-in-time freshness check immediately before action, not a continuous monitor. A single fresh read is authoritative; if the state is still ambiguous after the re-fetch, escalate to a human rather than retrying.

### Decision Checklist

Before any destructive action:

```
[ ] Have I named the specific target (ID, number, path)?
[ ] Have I chosen the correct authoritative source for this action type?
[ ] Have I re-fetched state within the last ~60 seconds?
[ ] Does the freshly-fetched state still justify the action?
     → YES: proceed (cite the fresh read)
     → NO: abort + log the stale-state discrepancy
```

## Evidence

### Realestate-radar #125 (2026-07-02): Sprint timeout after successful merge

Sprint task reported `❌ failed: Timeout` at 14,398 seconds. Recovery action was prepared. The triggering observation — the timeout notification — was accurate as a notification, but the *state it implied* was stale: `pull_request_read method=get` would have shown `merged: true` (PR #129 merged commit `8004f4c`, issue closed at 20:13Z). The failure was a post-merge bash cleanup process (`rm -rf /tmp/...`) running until the 4-hour cap — not a failed sprint.

**What the re-fetch would have shown:** `merged: true`, `issue state: closed` — both indicating completed work. Recovery would have been immediately aborted.

**Rule added to CONTEXT.md**: "A sprint 'failed: Timeout' is NOT proof of no-ship — a post-merge hung bash can run until the 4h cap AFTER merge + verify_deploy already succeeded. Before any recovery action, verify GitHub state directly."

### Realestate-radar #142/#143 (2026-07-04): Valid sprints killed on held issues

Issues #142 and #143 were held as `status:needs-input` pending a data-pipeline gate (issue #147). When issue #147 (live PLVR pipeline) merged, the resolver cron automatically lifted the hold — leaving un-hold comments on both issues explaining the cleared blocker — and re-dispatched them as `status:draft`.

The agent alarmed on the re-dispatch, classified it as "erroneous re-dispatch of a held item," and killed both valid sprints without reading the 2-line un-hold comments. `issue_read method=get_comments` would have shown the comments naming the cleared blocker.

**What the re-fetch would have shown:** Recent comments: "Un-holding: #147 (live PLVR pipeline) merged — blocker cleared." The sprint kill would have been aborted immediately.

**Rule added to CONTEXT.md**: "A 'held/needs-input issue got re-dispatched' alarm is USUALLY correct system behavior — READ THE ISSUE COMMENTS before taking destructive action (killing sprints)."

### General sprint timeout pattern (CONTEXT.md)

Multiple incidents across projects establish that `❌ Timeout` notifications do not distinguish between:
- Timeout during active work (true failure)
- Timeout during post-merge cleanup (false failure — work shipped)

The only reliable discriminator is a fresh `pull_request_read` check for `merged: true`. The notification alone is not sufficient to trigger recovery actions.

## Tradeoffs

**Latency**: Each re-fetch adds a single API call — typically under 1 second. The cost is negligible compared to the cost of incorrectly killing a completed sprint (which requires re-dispatch, re-execution, re-review, and re-merge, often 30–90 minutes of work).

**Over-fetching**: In high-volume scenarios with many monitored targets, frequent re-fetches could approach rate limits. The pattern gates re-fetching to the moment immediately before a *destructive action only* — not on every observation. The check is triggered by the action, not by the passage of time.

**False confidence**: A re-fetch is authoritative at query time but becomes stale immediately. The pattern uses this correctly — the check is performed immediately before the action, minimizing the staleness window. Do not re-fetch 5 minutes early and treat that read as "fresh."

**Cascading ambiguity**: After aborting a destructive action, the original trigger (e.g., the `❌ Timeout` notification) still requires explanation and resolution. The pattern resolves the immediate irreversible action; follow-up investigation of the trigger (why did the timeout occur, what cleanup is still running) is a separate step.
