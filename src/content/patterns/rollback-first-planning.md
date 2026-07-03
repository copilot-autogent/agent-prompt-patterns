---
title: "Rollback-First Planning"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Agents execute irreversible operations — database migrations, file deletions, deploy pipeline triggers — without first establishing how to undo them. When execution fails mid-way, there is no pre-defined recovery path. Rollback-First Planning requires agents to define, verify, and document a rollback procedure before executing any irreversible action. If a rollback cannot be verified before execution begins, the action must not proceed."
relatedPatterns: ["uncertainty-gated-irreversible-action", "dead-sprint-recovery", "side-effect-verification", "pre-commit-planning-phase"]
tags: ["safety", "rollback", "irreversible-actions", "planning", "migrations", "production-ops", "failure-recovery", "deploy"]
---

## Problem

An agent plans and executes an irreversible operation — a schema migration, a batch file deletion, a deploy pipeline trigger, a branch reset — without first establishing how to undo it. Execution starts, something fails mid-way through a multi-step process, and there is no pre-defined recovery path.

The failure modes compound:

**Partial-state traps**: A migration applies three of five steps before failing. Rolling back step three requires reversing state created in steps one and two. Without a written rollback plan, the agent must reconstruct the undo sequence under pressure, with incomplete context, against a system now in an ambiguous intermediate state.

**Improvised rollback failures**: When agents improvise rollback steps without prior verification, those steps frequently fail themselves. The rollback script references a backup file that was never created. The `git reset --hard` targets a SHA that no longer exists. The snapshot was from a prior deploy cycle and doesn't cover the new schema.

**Escalation without a handoff**: When improvised rollback fails, the only remaining option is human escalation. The agent cannot document what was tried, what state the system is in, or what the safe recovery sequence would be — because that sequence was never written.

In documented sprint incident logs (CONTEXT.md), multiple mid-flight sprint failures left open, un-merged PRs with systems in partial states. The Dead Sprint Recovery pattern addresses *detection* of these failures; Rollback-First Planning prevents the unrecoverable partial states from forming.

## Context

This pattern applies whenever an agent is about to execute an action that passes the irreversibility test:

> "If this action completes partially, can the result be reversed without data loss or downtime?"

If the answer is **no**, Rollback-First Planning is mandatory. If the answer is yes, proceed normally.

**Scope triggers — apply this pattern for:**

- Schema migrations with no `down` migration defined (forward-only migrations)
- File batch deletions without a durable copy or backup present (note: a local `git stash` is NOT a durable rollback artifact — it is ephemeral, local to one machine, and garbage-collectable)
- Deploy pipelines with no instant-rollback mechanism (e.g., no previous release pinned for re-deploy)
- Any operation touching production data (records, credentials, access control rules)
- Branch resets or force operations on shared branches
- Third-party API calls that trigger external side effects (webhooks, billing events, notification sends)

**Scope exclusions — this pattern is NOT required for:**

- Read-only operations (queries, file reads, status checks)
- Operations with trivially invertible effects **and no external side effects** — e.g., creating a file that can be removed. Note: inserting a database row is *not* trivially invertible if the insert triggers webhooks, increments counters, generates auto-increment IDs visible to other systems, or creates audit/history records.
- Operations already gated by an upstream checkpoint system that guarantees rollback capability

## Solution

Apply the following five-step procedure in order. Do not skip steps; do not reorder them.

### Step 1: Classify the action

Before writing any execution plan, explicitly answer: *"Is this action irreversible?"* Apply the test above. Write the classification into the working context so it is visible to any subsequent review.

> **Classification**: "This migration has no `V002__down.sql`. Partial failure cannot be reversed automatically. Rollback-First Planning applies."

### Step 2: Define the rollback

Write out, step-by-step, the procedure to return to the current state if the action fails at each stage. Be specific: name files, SHAs, snapshots, commands.

> **Rollback plan (if step 3 fails after step 2 completes):**
> 1. Run `psql -f V002__down.sql` against the target database (file must exist at `/ops/migrations/V002__down.sql`)
> 2. Restore application snapshot `backup-2026-07-03-pre-migration` from S3 bucket `app-snapshots`
> 3. Re-deploy the previous release tag `v1.4.2` via the deploy pipeline

For multi-stage actions, write a rollback entry for each stage: "if step N fails, undo steps 1…N-1 as follows."

### Step 3: Verify rollback feasibility

Before executing the forward action, confirm that every resource named in the rollback plan *exists, is accessible, and corresponds to the current pre-change system state*:

- The rollback script is syntactically valid and targets the correct schema version. Use a lint tool (`sqlfluff lint V002__down.sql`) or test execution against a staging schema (`psql --single-transaction -f V002__down.sql staging_db` — the transaction auto-rolls back if `ON_ERROR_STOP` triggers, or can be committed to verify idempotency). Note: `\i` is a psql interactive meta-command and cannot be used inside `-c`; always use `-f filepath` for file-based migration verification.
- The backup file is present, non-empty, and was created **after the last known-good state and before this operation** (verify the timestamp: `aws s3 ls s3://app-snapshots/backup-2026-07-03-pre-migration --human-readable`)
- The previous release tag exists in the deploy system and is deployable. For multi-revision deployments (blue/green, canary, multi-region), verify the rollback target is compatible with **all currently active revisions**, not just the primary production slot.
- For branch reset or force operations: the pre-operation ref must be durably preserved — push an explicit tag or create a named backup branch (`git tag pre-op-backup-<timestamp> && git push origin pre-op-backup-<timestamp>`), since `git reflog` is local and garbage-collectable. Verify force-push permission via the platform API (e.g., `gh api /repos/OWNER/REPO/branches/BRANCH/protection`), not `git remote show origin`, which does not report server-side protection rules.

**If any rollback resource cannot be verified, the forward action must not proceed.** Create the missing resource first (take the backup, write the down migration, pin the release), then re-verify before proceeding. If creating the missing resource is infeasible within the operation's time budget, escalate rather than proceeding without a verified rollback.

### Step 4: Execute forward

Proceed with the original action only after the rollback plan is written and all resources are verified. Keep the rollback plan in the working context throughout execution.

### Step 5: On failure — execute the rollback plan, not improvisation

If the forward action fails, execute the pre-defined rollback steps exactly as written. Deviate only if a specific step proves infeasible, and document the deviation explicitly:

> "Step 2 failed: backup file was corrupted (0 bytes). Escalating to human: system is in partial-migration state, steps 1–2 of 5 applied, no automated rollback available. Last known-good snapshot: `backup-2026-07-02`."

Never improvise new rollback steps from scratch under failure conditions. The pre-failure context is better than the post-failure context for writing recovery procedures.

## Protocol

The OBSERVE → HYPOTHESIZE → MINIMISE → TEST → EVALUATE → DOCUMENT loop applies to the verification phase:

1. **OBSERVE** — inspect current system state (backup presence, migration status, branch state)
2. **HYPOTHESIZE** — identify what could fail and at which step
3. **MINIMISE** — reduce the forward action scope to smaller atomic steps with intermediate checkpoints, each with its own rollback plan, so that partial failure is contained to one step's scope
4. **TEST** — run syntax-check or staging-only versions of the rollback commands to confirm they execute without error
5. **EVALUATE** — confirm all rollback resources verified for all stages; block if any are missing
6. **DOCUMENT** — write the verified rollback plan into the working context before proceeding

## Anti-patterns

**"I can always undo it with `git reset --hard`"** — without verifying that the target SHA exists, the branch allows force operations, and the working tree state has been stashed or is otherwise recoverable. This statement is commonly false for shared branches and forward-only migrations.

**Planning rollback after the action has already started** — rollback plans written under failure conditions are based on incomplete post-failure context. The verification step (Step 3) becomes impossible once the forward action has altered the system state.

**Rollback plans that depend on state the forward action itself destroys** — e.g., "if the migration fails, restore from the pre-migration backup" when the backup is written to the same database table being migrated. Verify that rollback resources are *independent* of the forward action's side effects.

**Treating rollback as a last-resort option** — rollback plans should be written even when the forward action is expected to succeed with high probability. The cost of writing the plan is low; the cost of not having it on the one failure is high.

**Verbal rollback plans** — rollback procedures must be written, not held in working memory. A verbal plan ("I'll just revert the commit") is lost when context is exhausted or the session ends mid-failure.

**Verifying existence without verifying version** — a backup that passes an existence check may predate the current schema version and be useless for restoring from the current state. Always verify that rollback resources correspond to the *current* pre-change state, not merely that they exist.

**Treating a local `git stash` or `git reflog` as a durable rollback artifact** — both are local and garbage-collectable. They are not available on other machines, after a `git gc`, or in a new clone. Durable rollback artifacts must be pushed to a remote (backup branch, tag, S3 object, database dump).

## Evidence

**Sprint mid-flight failures**: Multiple sprint agent failures left systems in partial states requiring manual human intervention. CONTEXT.md documents deploy pipeline failures (GitHub Pages timeout) that were harder to recover from when no instant-rollback mechanism existed — the previous release had not been pinned and the deploy system had no re-deploy button for prior builds. Establishing rollback-first as a pre-condition would have blocked these pipelines until a rollback path was confirmed.

**Improvised rollback failure modes**: In documented incident recovery (shogi-srs, realestate-radar), agents improvising rollback steps post-failure had a materially lower success rate than agents executing pre-written steps. The primary failure mode: rollback resources referenced in improvised plans (backup files, prior SHAs, stash entries) had not been created before the forward action began.

**Large-file sprint failures**: A sprint editing a 148KB data file (`subsidies.json`) hit repeated push failures, then shipped a PR that deleted 90% of the dataset as a "minimal CI-green set." A rollback plan (verified backup before starting the edit operation) would have caught the absence of a backup and blocked the forward action until one was created.

## Tradeoffs

**Upfront time cost**: Writing and verifying a rollback plan adds 2–5 minutes before the forward action begins. For frequently executed operations (daily deploys, routine migrations), this cost is not zero. Mitigation: templatize rollback plans for recurring operation types so verification, not authoring, is the primary cost.

**False negatives on "verified" resources**: A backup that passes an existence check (`aws s3 ls`) may still be corrupted, incomplete, or too old to be useful. Verification depth must be calibrated to the operation's risk level: for high-risk operations, a restore dry-run is warranted; for moderate-risk, an existence check plus timestamp validation is sufficient.

**Scope creep on preparation**: If creating a missing rollback resource (taking a backup, writing a down migration, pinning a release) proves complex or time-consuming, the preparation phase can expand to exceed the operation's budget. Set a time limit; if the rollback resource cannot be created within that limit, escalate rather than proceeding without a verified rollback.
