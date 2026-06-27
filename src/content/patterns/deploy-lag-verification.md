---
title: "Deploy-Lag Verification"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "Agents declare a fix 'live' immediately after merge, but code only takes effect when the runtime restarts with a rebuilt artifact. To avoid false-green incident diagnoses, an agent must verify two independent facts after every merge: (1) is the fix in the running artifact, and (2) did the process restart after the fix was built? Neither check alone is sufficient."
relatedPatterns: ["side-effect-verification", "empirical-validation-loop", "observe-resolve-pairing", "sprint-continuity"]
tags: ["reliability", "verification", "deployment", "debugging", "incident-response", "false-green", "merge-vs-deploy"]
---

## Problem

An agent merges a fix, sees the PR marked "merged", and declares the issue resolved. Hours or days later, the bug recurs. The agent re-opens the incident, re-investigates the code, and concludes the fix "didn't work" — spending significant time on a problem that was already solved.

The actual cause: the fix was never deployed. The running process loaded its code at startup from a build artifact that predated the patch. The merge happened; the deployment did not.

Two compounding assumptions produce this failure:

**"Merged = deployed"**: Agents conflate the source-control state with the runtime state. Merging a PR changes the repository. It does not change what a running process is executing. A Node.js server, Python daemon, or compiled binary loads code into memory at start time and is blind to all subsequent repository changes until it is restarted from a new build.

**"Process is running = process is current"**: An agent checking "is the service running?" gets `yes` and infers "therefore it has the latest code." But the process may have started hours before the patch was merged. Runtime liveness is independent of runtime currency.

The gap between these two assumptions creates a deploy-lag window. Inside that window, every health check will show the buggy behavior, and every incident will look like "the fix didn't work" when the real diagnosis is "the fix was never loaded."

## Context

This pattern applies whenever:

- An agent merges a bug fix and then monitors for recurrence
- An agent diagnoses a recurring incident in a system that was recently patched
- An agent attributes a successful recovery to self-healing or automation when a human may have manually restarted the service
- Any agent operating in a long-running system where deployments require an explicit restart step separate from the merge step

The pattern is especially important in systems where:

- **The deployment pipeline is not fully automated**: Code must be compiled (`npm run build`, `tsc`, `go build`) and then the process manually restarted. A merge alone does not trigger this chain.
- **Multiple agents share a production system**: One agent merges a fix while another monitors the system, creating a gap where the monitoring agent may never observe the deployment step.
- **The self-healing mechanism is unverified**: The system may have a restart hook or health-check-triggered recovery, but that hook may itself have bugs. "It should restart itself" is not the same as "it did restart itself."

## Solution

After merging a fix, verify two independent facts before declaring it active:

**Check 1 — Is the fix in the running artifact?**

Compare the commit SHA embedded in the running process against the merged commit. The running process must reference a build that was created *after* the fix was merged.

```bash
# In the running deployment:
cd /path/to/app && git log --oneline -1
# → abc1234 fix: authentication token refresh

# On the source repository:
# github-list_commits sha=main (first result)
# → abc1234 fix: authentication token refresh
```

If they differ, the artifact has not been rebuilt from the patched commit. The fix is not running.

For compiled artifacts without embedded git metadata, a targeted content search works:

```bash
grep -rl 'newFunctionOrSymbol' /path/to/app/dist/
```

Absence means the build predates the fix.

**Check 2 — Did the process restart after the fix was built?**

The process start timestamp must postdate the merge timestamp. A process running since before the merge loaded pre-fix code regardless of what the repository now shows.

```bash
# Find process start time from logs:
grep -E 'started|logged in|TaskScheduler started' /path/to/app.log | tail -1
# → 2026-06-19T23:06:00Z TaskScheduler started

# Compare against merge timestamp (from PR or git log):
# → PR #647 merged 2026-06-20T00:53:00Z

# 23:06 < 00:53 → process started BEFORE the fix. Not running the patch.
```

**The two checks are jointly necessary:**

| Artifact rebuilt? | Process restarted after build? | Status |
|---|---|---|
| ✅ Yes | ✅ Yes | Fix is running |
| ✅ Yes | ❌ No | Fix not running (restart pending) |
| ❌ No | ✅ Yes | Fix not running (stale build) |
| ❌ No | ❌ No | Fix not running |

Only the first row means the fix is active.

**Prompt template:**

```
After merging [fix], verify deployment before declaring it active:

1. Check running artifact: [command to read embedded commit SHA or grep for key symbol]
   → Must match merged commit [SHA]

2. Check process start time: [command to grep process start from logs]
   → Must be AFTER merge time [timestamp]

If either check fails, the fix is merged but not deployed. Do not diagnose recurrences as "fix not working" until both checks pass.
```

**Handling self-healing claims:**

If the system is supposed to auto-restart on failure, do not assume it did. Verify via log markers:

```bash
grep -E 'auto-restart|recoverClientOnce|health-check-triggered' app.log | tail -5
```

Absence of these markers means the self-heal mechanism did not fire. The recovery — if it happened — was manual. Attribute it correctly.

## Evidence

Multiple production incidents in an autonomous AI agent system (June 2026) provide direct evidence of the deploy-lag failure mode.

**Incident A — Fix never deployed, bug misdiagnosed (PR #647, June 2026):**

A critical authentication bug was patched and merged at 2026-06-20T00:53Z. A scheduled health check reported the bug recurring at 2026-06-21T06:00Z — 30+ hours later. Initial analysis concluded "the fix didn't work."

Root-cause reconstruction from process logs:
- Process last restarted: 2026-06-19T23:06Z
- Fix merged: 2026-06-20T00:53Z
- Gap: process started **1 hour 47 minutes before** the fix

The process was running pre-fix code from the moment the patch was written until a human manually rebuilt and restarted the container at 07:20Z. The fix had never been deployed. The bug recurrence was real and expected.

Two-step deploy-lag verification would have surfaced this in under one minute. The actual investigation consumed hours.

**Incident B — Recovery misattributed (PR #645, June 2026):**

A system appeared to recover from an incident. The agent attributed recovery to a self-healing mechanism that should have triggered automatically.

Log analysis found:
- Self-heal markers: absent from log
- Process restart marker: `2026-06-21T07:20Z` — aligned with a human-initiated container rebuild
- Conclusion: self-healing never fired; a human rebuilt and restarted manually

The misattribution mattered because "self-healing worked" would have closed the incident, while "human intervention required" correctly identified a gap in the automated recovery path.

**Abstracted evidence statement:**

In a production AI agent system, a critical authentication bug was patched and merged. A scheduled health check reported the bug recurring 30 hours later. Root-cause analysis found the patch had never been deployed — the process had last restarted 107 minutes *before* the patch was merged, and no artifact rebuild had occurred. The false "fix not working" diagnosis consumed significant investigation time that a two-step deploy-lag check would have saved in under a minute.

## Tradeoffs

**Benefit**: Eliminates a systematic false-green failure mode. Deploy-lag verification turns "the fix must not have worked" into "the fix is merged but not yet running" — a precise, actionable statement that points to the deployment step rather than the code.

**Cost**: Requires access to process logs and the running deployment environment. In environments where the deployment is fully automated and verified by CI/CD tooling, this check is redundant — the pipeline already guarantees deploy-after-merge. Apply the pattern where the deployment pipeline has a manual step.

**When to skip**: Stateless deployments (serverless functions, containers rebuilt on every push, blue-green with automatic traffic cut) typically eliminate the deploy lag by design. In these environments, "merged = deployed" may be approximately true — verify that the deployment pipeline is actually configured this way before skipping the check.

**Watch out for:**
- **Checking only the repository, not the artifact**: `git log` in the repo shows what was merged; it does not show what was built. The artifact could be a stale pre-merge build even if the repository is at the latest commit.
- **Checking only the artifact, not the process start time**: A post-merge build that hasn't been deployed yet will pass Check 1 but fail Check 2. The process must have started *after* the build that contains the fix.
- **Trusting self-healing claims without log evidence**: Automated restart mechanisms fail silently. Always verify via log markers, not by inferring from "the service is up."

## Related Patterns

- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the general principle: verify observable outcomes rather than trusting return values or status reports; deploy-lag verification is the specific application of this principle to the merge→deploy transition
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — when monitoring for fix effectiveness, treat post-merge observations as a measurement, not a conclusion; verification requires checking deployment state before interpreting monitoring data
- **[Observe-Resolve Pairing](/agent-prompt-patterns/patterns/observe-resolve-pairing)** — the "observe" step in incident response should include deployment state as a first-class observable; an undeployed fix is a known observable state, not an anomaly
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — a sprint manifest that records "merged PR #47 at commit abc123 at 00:53Z" enables the next sprint to run deploy-lag verification without re-reading all logs; structured handoff reduces the cost of the two-step check
