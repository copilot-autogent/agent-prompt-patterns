---
title: "Pre-Destruction State Revalidation"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Before executing any destructive action (killing an agent, closing an issue, reverting a PR, deleting a branch), re-fetch the current external state from the authoritative source rather than relying on the in-context observation that triggered the alarm. The in-context state is a snapshot — it can be stale by minutes or hours. Two confirmed incidents where agents killed valid sprints or prepared unnecessary recovery work because a timeout notification or cached label pre-dated an already-completed merge. Rule: read-then-act, not notify-then-act. This pattern specializes uncertainty-gated-irreversible-action by focusing specifically on the *freshness* dimension: even when the agent is subjectively certain about a state, that state must be re-verified from the live source before destruction."
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
| Kill sprint / stop agent | GitHub: issue state + open PRs; scheduler: agent session status | `issue_read method=get` → check `state` and `labels`; `pull_request_read method=get` → check `merged` for PRs linked to this issue (note: with stacked or follow-up PRs, a merged PR does not always mean all work is complete — verify the specific PR directly tracking the sprint's deliverable); also `list_agents` to confirm the session is still active and has not already exited or completed handoff |
| Close issue | GitHub: issue state, labels, and comments | `issue_read method=get` → check current `state` and `labels`; `issue_read method=get_comments` → read most recent comments for un-hold, un-block, or re-dispatch signals; use both — comments alone may miss a label change, and labels alone may miss a comment that explains why the label was set. Note: label and timeline events not visible via comments can also signal holds — when in doubt, check labels explicitly |
| Reopen issue | GitHub: issue comments and linked work | `issue_read method=get_comments` → confirm the hold/block condition still applies; note that reopening is a lower-stakes action (reversible) but may still trigger unintended re-dispatches, so validate the reason before proceeding |
| Revert or close PR | GitHub: PR merge status | `pull_request_read method=get` → confirm `merged: true`/`false` and review last commit timestamp |
| Delete branch | GitHub: branch references and open PRs | `list_pull_requests` filtered to this branch as `head` → confirm no open PRs reference it; check whether the branch is the repo default or marked protected before proceeding; to verify unique commits are merged (accounting for rebases/force-pushes where commit SHAs differ), use `get_commit` on the branch HEAD and confirm its content is present in the merge target rather than relying on ancestry by SHA alone |
| Other destructive action | Depends on target | Re-fetch from the canonical source that owns that target's state |

**Timing rule**: The re-fetch must happen *immediately before* the destructive action — not minutes earlier during the diagnostic phase. State can change between your diagnostic read and your action.

### Step 3 — Compare fresh state against the trigger condition

Ask: does the freshly-fetched state still justify the destructive action?

**If YES — state still warrants the action**: Proceed, and reference the fresh observation in the action's rationale. Example: "Killing sprint: `issue_read` at HH:MM confirms `state: open`, no un-hold comments, no linked merged PR."

**If NO — state has changed**: Abort the destructive action. Log the stale-state discrepancy explicitly: "Trigger: `❌ Timeout` notification. Fresh read: `pull_request_read` shows `merged: true` at 20:13Z. Aborting recovery — sprint already completed." Update the in-context model to reflect actual state.

### Step 4 — One re-fetch is enough; escalate on genuine ambiguity

In most cases a single fresh read is sufficient. However, if the re-fetched state is itself ambiguous or incomplete (e.g., the issue is closed but an open PR for the same issue is still unmerged), a single targeted follow-up read is appropriate — but only to resolve that specific gap. Do not poll or loop. If the state remains genuinely ambiguous after two reads, do not proceed with the destructive action: escalate to a human, log the ambiguity, and park the task as `status:needs-input`. Allowing a destructive action under sustained ambiguity defeats the purpose of this pattern.

### Decision Checklist

Before any destructive action:

```
[ ] Have I named the specific target (ID, number, path)?
[ ] Have I chosen the correct authoritative source for this action type?
[ ] Have I re-fetched state immediately before this action (not from an earlier diagnostic step)?
[ ] Does the freshly-fetched state still justify the action?
     → YES: proceed (cite the fresh read)
     → NO: abort + log the stale-state discrepancy
[ ] If the re-fetch result is ambiguous, have I done at most one targeted follow-up read?
     → Still ambiguous after two reads: escalate to human; park as needs-input
```

## Relationship to uncertainty-gated-irreversible-action

`uncertainty-gated-irreversible-action` gates destructive actions on the agent's *confidence level* about its current understanding. This pattern specializes that prescription along a different axis: **observation freshness**. The key distinction:

- `uncertainty-gated-irreversible-action`: "Am I certain enough to proceed?" — fires when the agent's subjective uncertainty is high
- `pre-destruction-state-revalidation`: "Is my observation current enough to proceed?" — fires unconditionally, even when the agent is subjectively certain

An agent can be highly confident about a state that is nonetheless stale. A timeout notification is unambiguous — it says "this sprint failed" — but the conclusion it implies ("the sprint's work was not completed") can be wrong because the state changed after the notification was generated. High subjective confidence does not guarantee observation freshness.

Apply both patterns together for destructive decisions: gate on certainty (`uncertainty-gated-irreversible-action`) AND re-fetch for freshness (this pattern). Neither subsumes the other.

**TOCTOU note**: A re-fetch read and the subsequent destructive action are not atomic. In theory, state can change between the read and the action (time-of-check to time-of-use). In practice, this window is negligible for non-adversarial agent workflows, and the benefit of eliminating minutes-stale observations far outweighs the residual sub-second race. For high-stakes actions where even this window matters, the correct response is to use a locking API or a conditional write (e.g., `update issue state where current_state = X`), not to avoid the re-fetch.

## Evidence

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
