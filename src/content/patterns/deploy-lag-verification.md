---
title: "Deploy-Lag Verification"
category: "feedback-loops"
evidenceLevel: "strong"
summary: "After merging a fix, verify two facts before declaring it live: the artifact was rebuilt from the patched commit, and the process restarted after that build. Neither alone is sufficient."
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
- **Multi-replica or rolling deployments**: In systems with multiple instances (e.g., Kubernetes pods, load-balanced servers), verifying one instance is insufficient. Each replica loads its own copy of the artifact at startup. Confirm the check covers all instances, or use a fleet-wide deployment verification tool.

## Solution

After merging a fix, verify two independent facts before declaring it active:

**Check 1 — Is the fix in the running artifact?**

Confirm the deployed artifact was built from a commit that includes the fix. `git log` in the deployment directory shows the *repository* state, which can differ from the *artifact* state if the code was updated but not rebuilt. One practical check is a content search in the compiled output:

```bash
# Compiled artifacts — search the built output for a symbol introduced by the fix:
grep -rl 'newFunctionOrSymbol' /path/to/app/dist/
# Absence suggests the build predates the fix.
# Caveats: (1) minification or tree-shaking may rename symbols — use a stable
# string literal or unique log message when possible; (2) grep over the entire
# dist directory may match stale build artifacts, source maps, or non-active
# release directories — scope the path to the artifact your process actually loads.
```

For interpreted languages or deployments with embedded git metadata:

```bash
# Check that the running checkout matches the merged commit:
cd /path/to/app && git log --oneline -1
# Compare against: github-list_commits sha=main (first result)
# If they match AND the build step ran after this checkout, the artifact is current.
```

Important: if the repository shows the merged SHA but the build step (`npm run build`, `tsc`, etc.) has not run since the checkout, the artifact is still stale. Repository state and artifact state are distinct — always verify the artifact, not just the checkout.

Note on squash/rebase merges: a squash merge produces a new commit SHA that differs from the original branch. Verify by checking for a distinctive symbol or log string introduced by the fix, not only by SHA equality.

**Check 2 — Did the process restart after the artifact was built?**

The process start timestamp must postdate the artifact build timestamp (or, at minimum, the fix's merge timestamp). A process running since before the artifact was built loaded pre-fix code regardless of what the repository now shows.

```bash
# Find process start time from logs using application-specific startup markers:
grep -E 'started|logged in|TaskScheduler started' /path/to/app.log | tail -1
# → 2026-06-19T23:06:00Z TaskScheduler started
# Note: adapt the grep pattern to your system's actual startup log message.
# Log rotation or component-init messages with the same keywords can mislead;
# use the earliest startup marker that only fires at process start, not during operation.

# Compare against fix merge timestamp (from PR or git log):
# → PR #647 merged 2026-06-20T00:53:00Z
# Full comparison: 2026-06-19T23:06Z < 2026-06-20T00:53Z
# → Process started BEFORE the merge. Not running the patch.
```

Note: in environments where the build step is separate from the merge (e.g., merge triggers a CI pipeline that takes minutes), compare against the build completion time, not the merge time. A process that restarted immediately after merge but before the CI build finished is also running pre-fix code.

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

1. Check running artifact: [grep for a stable string/symbol introduced by the fix in the compiled output]
   → Should be present; absence indicates the build predates the fix
   → Note: if using SHA matching, squash/rebase merges produce a new SHA — verify content, not just SHA

2. Check process start time: [grep for process startup marker in logs]
   → Must be AFTER artifact build time [build timestamp]
   → (If build is immediate post-merge, comparing against merge time [merge timestamp] is acceptable,
      but if CI/build pipeline takes time, use the build completion time, not the merge time)

If either check fails, the fix is merged but not deployed.
In multi-instance deployments, run both checks on every replica.
Do not diagnose recurrences as "fix not working" until both checks pass on all instances.
```

**Handling self-healing claims:**

If the system is supposed to auto-restart on failure, do not assume it did. Verify via log markers:

```bash
grep -E 'auto-restart|recoverClientOnce|health-check-triggered' app.log | tail -5
```

Absence of these markers in the logs is *evidence against* self-healing having fired, but is not conclusive — log rotation, renamed markers, or a silent crash before the marker was written can produce the same absence. Use log-absence as a strong signal to investigate further, not as definitive proof. Attribute recovery to manual intervention only when you also have positive evidence (a human-initiated restart command, a container rebuild timestamp, an ops note).

## Evidence

Multiple production incidents in an autonomous AI agent system (June 2026) provide direct evidence of the deploy-lag failure mode.

**Incident A — Fix never deployed, bug misdiagnosed (PR #647, June 2026):**

A critical authentication bug was patched and merged at 2026-06-20T00:53Z. A scheduled health check reported the bug recurring at 2026-06-21T06:00Z — approximately 29 hours later. Initial analysis concluded "the fix didn't work."

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

In a production AI agent system, a critical authentication bug was patched and merged. A scheduled health check reported the bug recurring approximately 29 hours later. Root-cause analysis found the patch had never been deployed — the process had last restarted 107 minutes *before* the patch was merged, and no artifact rebuild had occurred. The false "fix not working" diagnosis consumed significant investigation time that a two-step deploy-lag check would have saved in under a minute.

*Note*: The concrete PR numbers and timestamps above are from the authoring team's own incident history and are included here as anchors for the specific evidence. Teams adopting this pattern should document their own evidence with as much or as little specificity as their operational context allows.

## Tradeoffs

**Benefit**: Eliminates a systematic false-green failure mode. Deploy-lag verification turns "the fix must not have worked" into "the fix is merged but not yet running" — a precise, actionable statement that points to the deployment step rather than the code.

**Cost**: Requires access to process logs and the running deployment environment. In environments where the deployment is fully automated and verified by CI/CD tooling, this check is redundant — the pipeline already guarantees deploy-after-merge. Apply the pattern where the deployment pipeline has a manual step.

**When to skip**: Fully automated deployment pipelines that verify rollout completion (e.g., Kubernetes rollout status checks, blue-green deployment with confirmed traffic cutover, serverless platforms where push atomically updates the running function) can make this check redundant — the pipeline already guarantees the new artifact is serving traffic. Apply the pattern when the deployment pipeline has a manual step, or when rollout verification is not part of the automated pipeline. Note: "containers rebuilt on every push" is not sufficient — rebuilding an image does not guarantee that running containers have restarted onto the new image.

**Watch out for:**
- **Checking only the repository, not the artifact**: `git log` in the deployment directory shows what commit was checked out; it does not show what was *compiled*. The artifact could be a stale pre-merge build even if the repository is at the latest commit. Verify the compiled output directly (grep for a key symbol, check the artifact's build timestamp).
- **Checking only the artifact, not the process start time**: A post-merge build that hasn't been deployed yet will pass Check 1 but fail Check 2. The process must have started *after* the build that contains the fix.
- **Trusting self-healing claims without log evidence**: Automated restart mechanisms fail silently. Always verify via log markers, not by inferring from "the service is up."

## Related Patterns

- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — the general principle: verify observable outcomes rather than trusting return values or status reports; deploy-lag verification is the specific application of this principle to the merge→deploy transition
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — when monitoring for fix effectiveness, treat post-merge observations as a measurement, not a conclusion; verification requires checking deployment state before interpreting monitoring data
- **[Observe-Resolve Pairing](/agent-prompt-patterns/patterns/observe-resolve-pairing)** — the "observe" step in incident response should include deployment state as a first-class observable; an undeployed fix is a known observable state, not an anomaly
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — a sprint manifest that records "merged at commit abc123 at 00:53Z" enables the next sprint to run deploy-lag verification without re-reading all logs; structured handoff reduces the cost of the two-step check
