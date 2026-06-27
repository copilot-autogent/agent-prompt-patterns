---
title: "Duplicate Agent Spawn Prevention"
category: "multi-agent"
evidenceLevel: "strong"
summary: "Agent tracking systems are eventually-consistent caches, not mutexes. They can report 'no active agents' while an agent is mid-flight in a silent review/refinement loop. Before spawning a replacement or supplementary agent, verify the expected artifact — not the roster. If the artifact exists and is still being updated, an agent is live. Wait rather than spawn."
relatedPatterns: ["staggered-task-spawning", "sprint-continuity", "dispatcher-pattern", "side-effect-verification", "circuit-breaker", "workspace-per-sprint-isolation", "sprint-completion-verification"]
tags: ["multi-agent", "spawning", "deduplication", "concurrency", "liveness", "artifact", "roster", "working-tree"]
---

## Problem

An agent orchestrator checks its task roster or session list and sees no active agents for a task. It spawns a new agent to handle it. The original agent was never dead — it had completed an early milestone (e.g., opened a PR) and entered a silent refinement loop. The roster simply wasn't updated to reflect this.

Two agents now operate on the same branch. They share a working directory, push interleaved commits, and produce a merged artifact that neither was responsible for. Untangling the collision costs more than the task itself.

Three failure signatures:

**Roster lag**: Agent tracking systems are updated asynchronously. An agent that starts, opens a PR, and continues refining may not appear in the active roster during the refinement phase. The supervisor interprets absence from the roster as absence in general.

**Post-milestone silence**: Many agents complete a visible milestone (PR open, initial commit) within the first few minutes of a long run. The rest of the run — review, refinement, re-push — produces no new roster entry and no orchestrator-visible signal. From the outside, the agent looks idle or terminated.

**False "no agents" signal**: `list_agents`, `read_agent`, or equivalent roster queries return truthful results about their own state, but their state may not reflect agents that: completed early milestones and continued; were spawned in a different session context; or exhausted the tracking window without terminating.

## Context

This pattern applies to any multi-agent system where:

- A supervisor or orchestrator queries agent state before spawning
- Agents have multi-phase lifecycles with a visible early milestone (PR creation, first commit, initial report) followed by a longer internal loop (review, refinement, re-run)
- The agent tracking system is eventually consistent rather than transactionally synchronized

It is most critical when two agents working concurrently would share a mutable resource: a git working directory, a memory topic, a deployment slot, a file. Read-only duplication (two agents investigating the same codebase) is safe. Write duplication (two agents pushing to the same branch) is not.

The pattern does NOT apply when duplicate agents are intentionally used for parallel investigation with separate outputs. It applies when the intent is "one agent, one task" and the concern is ensuring the invariant holds.

## Solution

**Verify the artifact before querying the roster. The artifact is ground truth; the roster is advisory.**

Apply this four-step check in order before spawning a replacement or supplementary agent for any task:

**Step 1: Does the expected artifact exist?**

Query whether the output artifact for the task already exists:
- For a coding task: does a PR for this branch already exist?
- For a data task: does the expected output file or database row already exist?
- For a scheduled task: does the output report or notification already exist?

If the artifact exists, the task has already been started (or completed). Do not re-spawn without understanding the artifact's state.

**Step 2: Is the artifact still being updated?**

If the artifact exists, check whether it is actively changing:
- For a PR: is the head SHA advancing? Has a commit been pushed in the last 5 minutes?
- For a file: is the mtime recent? Is the file still being written?
- For a database row: is the `updated_at` timestamp recent?

A recently-updated artifact is a reliable proxy for a live agent. Treat any artifact updated within the last 5 minutes as live unless there is specific evidence otherwise.

**Step 3: Has the original agent posted a completion signal?**

Check the agent's designated communication channel (Discord thread, log file, status field) for a completion message. Distinguish between:
- **No completion signal** — agent may still be running (normal for long refinement loops)
- **Explicit completion signal** — agent has finished; safe to act on the artifact
- **Explicit failure signal** — agent has terminated with error; may need recovery or re-spawn

Absence of a completion signal is NOT evidence of a dead agent. A long-running agent in a refinement loop may produce no channel output for 10–30 minutes while still actively working.

**Step 4: Apply a waiting bias.**

If the artifact exists, is recently updated, and has no completion signal — default to waiting, not spawning. The cost of waiting is latency; the cost of a collision is working-tree contamination, interleaved commits, and secondary defect introduction.

Set a concrete wait threshold: if the artifact has not been updated in more than N minutes (suggest: 15 minutes as a default), treat the agent as stalled and investigate before spawning.

```
Before spawning agent for task T:
  artifact = find_artifact(T)                 # task-scoped: e.g., PR for this task's branch
  if not artifact:
    # NOTE: no artifact does not guarantee no agent — the agent may not
    # have produced its first artifact yet. Apply a brief startup wait
    # (1–2 min) before concluding the task is unstarted, especially for
    # tasks dispatched in the last few minutes.
    spawn(T)                                  # likely safe; no artifact yet
  else:
    age = now - artifact.last_updated         # age since last artifact update
    if has_completion_signal(T):
      act_on_artifact(artifact)               # already completed; no spawn needed
    elif has_failure_signal(T):
      recover_or_respawn(T)                   # agent failed; recovery path
    elif age < 5min:
      wait()                                  # recently updated; agent is likely live
    elif age < 15min:
      wait()                                  # uncertain; waiting bias applies
    else:
      investigate_before_spawning(T)          # stalled; assess before deciding
```

## Evidence

**Production incident (autogent, 2026-06-21)**:

Sprint eph-10 was assigned a code task. Within the first minute of a 49-minute run, it opened PR #663. It then entered a review/refinement loop: re-running tests, reading review comments, pushing fixes.

During this refinement loop:
- `list_agents` returned `"no background agents"`
- `read_agent` returned `"not found"`

A supervisor, seeing no active agents in the roster and a PR that appeared "open but unattended," spawned eph-17 to assist.

Both eph-10 and eph-17 now owned the same working directory (`/tmp`) and branch. They began pushing interleaved commits. eph-10 detected the collision mid-run and spent significant effort reconciling. The rushed double-refinement introduced approximately 11 secondary bugs that required a third cleanup round to resolve.

The PR's head SHA had been advancing throughout eph-10's refinement loop — the artifact check would have revealed the live agent in under 5 seconds.

**Counterfactual**: Had the supervisor queried the PR's head SHA before spawning — a single API call — it would have seen a commit pushed 8 minutes prior. This falls in the 5–15 minute "uncertain" band, triggering the waiting bias. eph-17 would not have been spawned. The 49-minute eph-10 run would have completed cleanly, with no secondary bugs.

**Roster lag quantified**: In the same incident, the gap between eph-10's last roster-visible action and its actual termination was approximately 47 minutes. During this window, the roster correctly showed "no active agents" while an agent was actively working. Roster absence was a false negative for 96% of the agent's actual runtime.

## Tradeoffs

**Benefit**: Eliminates working-tree collisions, interleaved commits, and secondary defect introduction caused by concurrent agents on the same branch. Artifact-based liveness check is a single API call — under 5 seconds.

**Cost**: Introduces latency when a task has genuinely stalled. If an agent terminates without a completion signal and without updating the artifact, a waiting supervisor will wait longer than necessary before re-dispatching.

**Calibration guidance**:
- **5-minute threshold for "live"**: An agent that pushed a commit 5 minutes ago is almost certainly still running. Safe to wait.
- **15-minute threshold for "investigate"**: An artifact stale by 15 minutes may indicate a stalled or crashed agent. Before spawning, check whether the session is still active through another channel (process list, log file, direct status query).
- **No completion signal ≠ dead**: Long refinement loops with automated review tools can run 15–45 minutes with no user-visible output. This is normal. Absence of a completion signal alone does not justify spawning.

**Watch out for**:
- **Non-agent artifact updates**: A PR's head SHA can advance due to a human push, a bot auto-fix, or the very second agent you are trying to prevent. Treat recency as a necessary condition for liveness, not a sufficient one. When the identity of the last committer matters (e.g., to confirm it was the expected agent), check the commit author before concluding the original agent is live.
- **Pre-artifact phase**: An agent that has been dispatched but has not yet opened a PR or produced any artifact will not satisfy the existence check, and `spawn(T)` will fire. This is an inherent limitation: before any artifact exists, roster absence is the only signal available. Mitigate by applying a startup wait (1–2 minutes) before the first artifact check for recently-dispatched tasks, and by using dispatch-time records (e.g., noting in a task log the time a task was dispatched) to distinguish "never started" from "just started."
- **Artifact identity**: Ensure the artifact check is scoped to the current task instance, not just the artifact type. A stale PR from a previous attempt or a manually-created artifact with the same branch name will satisfy the existence check and incorrectly block a legitimate dispatch. Verify task-specific identity (e.g., PR branch matches the current issue's expected branch name) before treating existence as a liveness signal.
- **Agents that complete tasks without creating expected artifacts**: If a task's success leaves no artifact (e.g., a monitoring task that only sends a notification), artifact absence is not meaningful. Restrict this pattern to tasks with clear, queryable output artifacts.
- **Clock skew between environments**: If the agent and the supervisor run in different environments, `last_updated` timestamps may reflect different clocks. Use relative recency (age in minutes) rather than absolute timestamps where possible.
- **Recovery vs. duplication**: When an agent is confirmed stalled (artifact stale >30 minutes, no process running, no completion signal), spawning a replacement is correct. The pattern prevents premature duplication, not legitimate recovery. See [Circuit Breaker](/agent-prompt-patterns/patterns/circuit-breaker) for stall-recovery escalation.

## Related Patterns

- **[Staggered Task Spawning](/agent-prompt-patterns/patterns/staggered-task-spawning)** — prevents collision at spawn-time via scheduling; this pattern prevents collision at re-spawn-time via artifact verification. They are complementary: stagger initial spawns, artifact-check before supplementary spawns.
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — long-running sprints with early-milestone followed by refinement loops are the primary context where this pattern applies; sprint agents should write a clear completion signal to their thread to reduce the risk of being re-spawned.
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — confirms that an action actually happened by querying its observable side effect; this pattern applies the same principle to liveness detection: query the agent's side effect (the artifact) rather than the agent's self-reported state.
- **[Dispatcher Pattern](/agent-prompt-patterns/patterns/dispatcher-pattern)** — orchestration layer that may trigger duplicate spawns; this pattern is a guard applied inside the dispatcher's pre-spawn check.
- **[Circuit Breaker](/agent-prompt-patterns/patterns/circuit-breaker)** — provides the stall-recovery escalation path after the investigate step: when an agent is confirmed stalled (artifact stale >30 minutes, no active process, no completion signal), the circuit-breaker pattern determines when it is safe to terminate, reset, and re-dispatch rather than waiting indefinitely.
