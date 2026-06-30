---
title: "Evidence Freshness Decay"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Agents cache observations at task start and act on them later when the world has changed; assign a TTL to each piece of evidence and re-verify before acting when TTL expires or a forced re-verify trigger applies. When re-verify is blocked, acknowledge the staleness explicitly and prefer reversible actions."
relatedPatterns: ["memory-read-before-write", "enumeration-first-verification", "sprint-completion-verification", "strategic-recall-before-ideation", "uncertainty-gated-irreversible-action"]
tags: ["memory", "freshness", "ttl", "staleness", "re-verify", "caching", "snapshot", "state-verification", "multi-agent", "uncertainty"]
---

## Problem

Agents read the state of the world at a point in time — a file's contents, a GitHub issue's status, a CI result, a memory topic — and then treat that reading as authoritative for the remainder of the task. But the world keeps changing while the agent works.

Three compounding failure modes emerge from stale evidence:

**Snapshot-as-truth**: A saved manifest or memory topic is treated as the current state, not a snapshot of past state. Re-seeding tasks from a 6-day-old snapshot re-introduces problems that were already fixed — because the snapshot predates the fixes.

**Cross-session staleness**: When a new session loads memory topics, sprint summaries, or GitHub state from previous sessions, it is starting from a historical snapshot. Evidence sourced in a different session can be hours or days old before it is acted on.

**Sprint over-claiming propagates forward**: Sprint agents produce confident prose completion summaries that describe intended or attempted state. When the next sprint loads this summary as evidence of completion, it may skip work that was never actually done.

All three failures share the same root cause: the agent did not check *when* the evidence was produced before acting on it.

## Context

This pattern applies whenever an agent relies on observations that were not just made:

- Resuming work after a pause (the world changed while you were idle)
- Loading memory topics at session start (topics were last updated at an unknown time)
- Acting on a sprint agent's completion summary (the summary describes intent, not confirmed state)
- Re-seeding scheduled tasks from a snapshot document
- Making irreversible decisions (merges, closes, deletions) based on earlier-read state
- Working in a multi-agent system where another agent may have modified shared state

The pattern does NOT require re-reading everything on every step. Most evidence is stable within a single session. The cost of excessive re-reading is wasted tool calls and rate-limit pressure.

## Solution

### 1. Tag evidence at read time with a freshness TTL

When reading evidence, mentally (or explicitly) note when you read it and how long it stays valid:

| Evidence type | Suggested TTL | Rationale |
|---|---|---|
| File contents (own repo, same session) | 30 min (read-only); 0 for writes | In a single-agent session files change slowly; in a multi-agent workspace, another agent can modify a file at any time — re-read immediately before any write (see *Memory Read Before Write*) |
| GitHub issue / PR state | 10 min | PRs merge and issues close quickly |
| CI / deploy status | 5 min | Builds finish while you work |
| Memory topics | 1 session or 4 h, whichever is shorter | Re-read at session start; long-running sessions accumulate hours of drift |
| External API responses | 5–15 min | Rate-limited; world changes |
| Sprint agent summaries | Verify before trusting | Self-reports can over-claim |
| Snapshot documents (manifests, generated JSON) | 24 h max | Point-in-time export; world diverges fast |

### 2. Before acting, check evidence age

Before using cached evidence to drive a decision, ask:

> "When did I last read this? Has a TTL-relevant event occurred since?"

If yes → re-read the source before proceeding.

### 3. Apply forced re-verify triggers regardless of TTL

Some situations require fresh reads even if the TTL has not expired:

- **Before any irreversible action** (merge, delete, close, deploy) — see *Uncertainty-Gated Irreversible Action*
- **Before any read-modify-write on shared state** — re-read the source immediately before writing, regardless of when you last read it (see *Memory Read Before Write*)
- **When evidence was sourced from a different session or agent** — load time is unknown; treat as potentially stale
- **When the task depends on time-sensitive state** — CI result, deploy status, issue state before closing
- **When re-seeding from a snapshot older than 24 h** — diff against current live state before bulk-applying

### 4. Acknowledge staleness when re-verify is impossible

When rate limits, missing tokens, or other constraints prevent re-reading:

- State explicitly: *"Acting on {N}-hour-old snapshot; treating this as higher-uncertainty."*
- Prefer reversible actions over irreversible ones when operating on stale evidence
- If the decision is irreversible, wait or escalate rather than proceed on stale data

### Freshness signals in tool output

Watch for these indicators that evidence may be stale:

- **Memory topic `last-updated` timestamp** — compare to current time before trusting content; if the timestamp is missing or malformed, treat the topic as stale and re-read
- **GitHub `updated_at` on issues/PRs** — if newer than your read timestamp, something changed after you looked
- **The phrase "as of" in saved topics** — a staleness flag, not a freshness guarantee
- **Snapshot file generation dates** — `docs/*.generated.json` files are point-in-time exports; check when they were last regenerated

### Anti-pattern: snapshot-as-truth

```python
# BAD: treating a saved manifest as current state
manifest = recall_memory("cross-repo-backlog")  # 6 days old
re_seed_tasks(manifest)  # re-introduces already-closed problems

# GOOD: verify before acting on old snapshots; re-read each entity type separately
manifest = recall_memory("cross-repo-backlog")  # 6 days old
if manifest.age > 1_day:
    # Re-read every tracked entity class — not just open issues
    current_issues = github_list_issues(state="open")
    current_prs = github_list_prs(state="open")
    current_labels = github_list_labels()
    diff_and_reconcile(manifest, current_issues, current_prs, current_labels)
    re_seed_tasks(reconciled_state)
```

### Anti-pattern: trusting sprint summary prose

```python
# BAD: treating a sprint's completion prose as confirmed state
summary = load_sprint_summary("sprint-42")
# "Sprint completed: PR #105 merged, issue #65 closed"
mark_issue_done(65)  # acts on claimed state, not verified state

# GOOD: verify artifact state via structured API
pr_state = github_get_pr(105)  # fresh API call
issue_state = github_get_issue(65)
# Check both state AND that the PR's body references the issue (causal link)
if pr_state.merged and issue_state.closed and issue_closed_by_pr(issue_state, 105):
    mark_issue_done(65)
else:
    # Surface the mismatch explicitly rather than silently skipping
    log_mismatch("sprint-42 claimed merged/closed but actual state: "
                 f"PR merged={pr_state.merged}, issue closed={issue_state.closed}")
    re_schedule_work(65)
```

## Evidence

**Scheduled-tasks re-seed incident (2026-06-28)**: The `cross-repo-backlog` memory topic was built at 2026-06-28 14:44Z and still referenced 6 days later during a task re-seed. The snapshot predated three separate fixes: missing storage-cleanup steps (#708), retired label removal (#734), and a safety-config update. All three already-fixed problems were re-introduced by treating the 6-day snapshot as current state.

**Post-wipe session staleness**: Sessions after a system wipe used Discord history and GitHub state from hours prior as authoritative evidence, then made edits based on the stale snapshot rather than re-reading live state.

**Sprint over-claiming propagation**: Sprint summaries described complete merges and closes that had not yet occurred (summary written in the final seconds before timeout). The next sprint loaded these summaries as evidence of completion and skipped the unfinished work. This pattern is explicitly noted in CONTEXT.md as a recurring observed failure.

These three incidents are independent failure modes with the same root cause: no TTL check before acting on cached evidence.

## Tradeoffs

**Re-read cost vs. staleness risk**: Every re-read costs tool calls, latency, and potentially hits rate limits. For stable, slow-changing evidence (own-repo file contents within a session), re-reading on every use is wasteful. The TTL table calibrates this tradeoff: high-churn evidence (CI status, PR state) has short TTLs; slow-changing evidence (file contents) has longer ones.

**Uncertainty acknowledgement vs. decision paralysis**: When re-verify is blocked, acknowledging staleness explicitly ("acting on 6-hour-old data") is better than silently proceeding, but the agent must still act. Staleness acknowledgement is not a substitute for reversibility — prefer reversible actions, not inaction, when data is stale.

**Cross-agent trust vs. autonomy**: In multi-agent systems, one agent's output is another agent's input. Requiring full re-verification of all inter-agent evidence creates tight coupling and latency. The practical rule: re-verify when the evidence is irreversibility-adjacent (will be used to close, merge, delete) and accept cross-session evidence at face value for low-stakes reads.
