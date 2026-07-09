---
title: "Capability Pre-Flight Gate"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Before committing to a multi-step task, enumerate all required capabilities (tool access, auth tokens, API scopes, file permissions, system dependencies) and verify each is available and properly scoped. Surface gaps at task intake — before any irreversible step — rather than discovering them mid-flight after partial work has created a difficult-to-recover state."
relatedPatterns: ["subprocess-env-scope-verification", "graceful-capability-degradation", "tool-error-triage", "uncertainty-gated-irreversible-action", "bounded-autonomy", "data-feasibility-probe"]
tags: ["autonomy", "auth", "tokens", "permissions", "preflight", "intake", "verification", "sprint", "capabilities", "scoping", "fail-fast"]
---

## Problem

An agent begins a complex task, successfully completes several early steps — creating a branch, making file edits, opening a PR, triggering a deploy — then fails mid-flight because a required capability was unavailable. A token was present in the parent process but not propagated to the subprocess. A GitHub token had repo scope but not workflow scope. An API key was scoped to one repo but used cross-repo.

The partial work is now in an inconsistent state: a PR exists with incomplete changes, a deploy triggered with broken code, a branch created that was never cleaned up.

**Three reasons this failure mode recurs:**

**1. Capability requirements are implicit.** Agents design tasks against the happy path. Required tokens, scopes, and permissions are never written down. They're assumed to be available because they were available in the last similar task — even though the current task's context (different repo, different subprocess, different cron environment) may differ.

**2. Late discovery amplifies damage.** A capability gap discovered at step 1 costs one retry. The same gap discovered at step 8 — after irreversible steps 2 through 7 — requires manual cleanup of partial work, leaves the system in an inconsistent state, and may require human triage of what was and wasn't applied.

**3. Existing recovery patterns don't prevent the failure.** `graceful-capability-degradation` handles a capability failure after it occurs. `tool-error-triage` classifies errors after they're returned. `subprocess-env-scope-verification` addresses one specific env-propagation boundary. None of these create an upfront gate that prevents the agent from entering irreversible steps while a known gap exists.

**Observed production incidents:**

- `autogent` auth-death sprint cluster 2026-07-02: `factor-dashboard #99` and `cli-wrapper-monitor #50` both died mid-flight on the same day. Post-mortem showed `GITHUB_API_TOKEN` was not propagated to bash subprocesses — both agents had already created branches, made commits, and opened PRs before the auth failure.
- Multiple sprints used `GH_TOKEN` (scoped to `copilot-autogent/*`) for operations on the main autogent repo, causing silent auth failures. The scope mismatch was not caught at intake because no step explicitly mapped "task requires cross-repo write" → "requires GITHUB_API_TOKEN, not GH_TOKEN."
- Sprint agents using MCP GitHub tools (which succeed using MCP server auth) inferred that subprocess `$GITHUB_API_TOKEN` was also available. The two scopes are independent; inferring one from the other is a scope confusion error.

## Context

Apply this pattern at task intake — the moment a task plan is assembled but before any external mutation begins.

**The pattern is most critical when the task involves:**

- Subprocess shell calls (`bash`, `curl`, `gh`, scripts) that read env vars
- Cross-repo operations that require a different token than same-repo operations
- External API calls with specific required scopes (workflow dispatch, packages, secrets)
- File system writes to paths that may require elevated permissions
- System-level dependencies (binaries, build tools, native modules) that may not be installed
- Multi-step pipelines where partial execution leaves inconsistent state

**The pattern is low-overhead when:**

- The capability check can be a fast non-destructive probe (e.g., `get_me`, `HEAD` request, `ls`)
- The task plan is already being assembled — the manifest is generated during planning, not as extra work
- Most checks resolve in one turn before any external mutation

**Do not apply universally to every tool call** — that creates gate fatigue. The gate targets *task intake*, not individual tool calls. The question is: "before I begin this task, do I have everything I need to complete it?"

**Scope boundaries that commonly cause mid-flight failures:**

| Context | Common boundary | Failure mode |
|---|---|---|
| MCP tool call vs bash subprocess | `GITHUB_API_TOKEN` not propagated to subprocess env | Auth works in MCP, fails in curl/gh |
| Same-repo vs cross-repo | `GH_TOKEN` scoped to `copilot-autogent/*` only | Silent 403 on main repo operations |
| Token scope vs required scope | `repo` scope present, `workflow` scope absent | Can push code, cannot trigger workflow_dispatch |
| Container PID1 vs spawned agent | Agent session env ≠ PID1 env | Token visible at PID1, absent in agent subprocess |
| Cron vs interactive session | Cron env may omit vars present in interactive env | Cron-only failures that pass in manual runs |

## Solution

**Enumerate required capabilities, verify each before the first irreversible step, and fail fast on unresolvable gaps.**

### Step 1: Build a capability manifest

At task intake, list every external capability the task requires. For each, specify:

- **What**: the token, tool, permission, or system dependency
- **Scope**: what operations it needs to support (read-only vs write, same-repo vs cross-repo, specific API scopes)
- **Execution context**: where it will be used (MCP tool layer, bash subprocess, agent session)

```
Example manifest for a sprint that creates a branch, pushes code, and triggers CI:

Required capabilities:
1. GitHub write access to target repo
   - Token: GITHUB_API_TOKEN
   - Scope: repo (push), workflow (dispatch)
   - Context: subprocess bash + MCP tools
2. npm install / build toolchain
   - Dependency: node >= 18, npm >= 8
   - Context: subprocess bash
3. Write access to /tmp working directory
   - Context: subprocess bash
```

### Step 2: Run minimal verification probes

For each capability in the manifest, run the lowest-cost non-destructive check that would fail if the capability were absent:

```
Capability → Probe
──────────────────────────────────────────────────────────
GitHub API access (MCP)      → github-get_me (returns login or errors)
GitHub API in subprocess     → curl -s -o /dev/null -w "%{http_code}" \
                                 -H "Authorization: Bearer $TOKEN" \
                                 https://api.github.com/user
Specific repo write scope    → GET /repos/{o}/{r} and check .permissions.push
                                 (non-destructive; returns push:true/false)
workflow_dispatch scope      → GET /repos/{o}/{r}/actions/workflows
                                 (non-200 = likely access issue, but 403 can
                                  also be transient; 200 confirms actions:read
                                  only — dispatch requires actions:write which
                                  cannot be probed non-destructively pre-flight;
                                  document as best-effort, accept residual risk)
node/npm version             → node --version && npm --version
Write permission to path     → PROBE=$(mktemp -p /tmp) && rm -f "$PROBE"  # mktemp creates the file; probe = can create
System binary present        → which <binary>
```

**Probing write scope non-destructively:** The repository metadata endpoint returns a `permissions` object that reflects the effective push/admin access for the authenticated token — no write required:

```bash
# Check repo write access without creating any refs
REPO_RESP=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $TOKEN" \
            https://api.github.com/repos/{owner}/{repo})
HTTP=$(echo "$REPO_RESP" | tail -1)
BODY=$(echo "$REPO_RESP" | sed '$d')
if [ "$HTTP" != "200" ]; then
  echo "GATE FAIL: repo API returned HTTP $HTTP (auth failure, not-found, or rate limit)"
  exit 1
fi
# Use jq if available (reliable); fall back to grep (fragile: field order/spacing matters)
if command -v jq >/dev/null 2>&1; then
  PUSH=$(echo "$BODY" | jq -r '.permissions.push // false')
else
  PUSH=$(echo "$BODY" | grep -o '"push":[[:space:]]*[^,}]*' | grep -o 'true\|false' | head -1)
fi
[ "$PUSH" = 'true' ] || \
  { echo "GATE FAIL: token lacks push permission on {owner}/{repo} (or response not parseable)"; exit 1; }
```

**workflow_dispatch note:** `GET /repos/{o}/{r}/actions/workflows` requires only `actions:read` scope — a 200 confirms Actions access but does **not** verify dispatch permission (`actions:write`). A 403 may indicate missing scope, but is also returned transiently by rate limiting, SSO enforcement, or org policy. Classify a 403 as “likely no access” (not “definitely no access”) and use `tool-error-triage` to distinguish permanent from transient. If workflow dispatch cannot be definitively verified pre-flight, document it as an unverifiable dependency and accept the residual risk.

**Critical:** verify in the **actual execution context** where the capability will be used. A token that succeeds in an MCP tool call may not be present in a subprocess. Check both scopes independently if both will be used.

```bash
# Verify token is available and valid in subprocess context (not just MCP layer)
TOKEN="${GITHUB_API_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "GATE FAIL: GITHUB_API_TOKEN not available in subprocess env"
  echo "Recovery: ensure the token is injected into the subprocess execution environment"
  exit 1
fi
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
       -H "Authorization: Bearer $TOKEN" \
       https://api.github.com/user)
[ "$HTTP" = "200" ] || { echo "GATE FAIL: token invalid (HTTP $HTTP)"; exit 1; }
```

Note: if the token is absent from subprocess env, see `subprocess-env-scope-verification` for recovery options (e.g., extracting from the parent process env). Do not embed token-recovery logic in the pre-flight gate itself — keep the gate a pure read/probe; recovery is an environment setup concern separate from intake verification.

### Step 3: Classify gaps and decide

For each failed probe, classify the gap and apply the appropriate response:

| Gap type | Classification | Response |
|---|---|---|
| Token absent from subprocess; present at PID1 | Environment setup gap | Surface gap; see `subprocess-env-scope-verification` for recovery options — do not recover inline in the gate |
| Token absent entirely (not in PID1, not in env) | Blocker — cannot proceed | Surface gap, stop before any irreversible step |
| Wrong token scope (e.g., GH_TOKEN vs GITHUB_API_TOKEN) | Blocker for cross-repo ops | Use correct token, or scope task to operations the token supports |
| Missing system dependency (node, npm, binary) | Blocker if binary is absent | Surface gap and stop — installing during intake is a mutating step; installation is a pre-task setup concern, not inline gate remediation |
| Insufficient file permission | Blocker | Surface gap; do NOT attempt `chmod` or other remediation during intake (that is a mutating step, not a probe) |
| API scope missing (e.g., no `workflow` scope) | Partial blocker | Proceed on steps that don't require missing scope; explicitly skip or defer scoped steps |

**Fail fast on unresolvable blockers:**

```
GATE RESULT: 2 of 4 checks failed.
  ✗ GITHUB_API_TOKEN in subprocess: not present in subprocess env, not in PID1
  ✗ workflow dispatch scope: /actions/workflows returned 403

Stopping at intake. No irreversible steps have been taken.
Recovery: surface to operator — provide GITHUB_API_TOKEN with workflow scope
         in the sprint execution environment, then re-dispatch.
```

### Step 4: Scope the task to available capabilities

If a gap is partial (some capabilities available, some not), determine whether the task can be decomposed:

- **Proceed at reduced scope**: complete the steps that don't require missing capabilities; explicitly document what was skipped and why.
- **Halt the entire task**: if the steps requiring missing capabilities are prerequisites for all other steps, stopping entirely is correct. Do not produce partial output that implies completeness.

The key question: *would completing only the available-capability steps leave the system in a worse state than not starting at all?* If yes, halt entirely.

## Anti-Patterns

**Inferring subprocess scope from MCP tool success.** An MCP GitHub tool call succeeds using MCP server auth. The agent infers that `$GITHUB_API_TOKEN` is therefore available in subprocess env. These are independent auth scopes — MCP success is not evidence of subprocess availability.

```
Wrong: "get_me succeeded, so the token is available"
Right: verify $GITHUB_API_TOKEN explicitly in the subprocess context that will use it
```

**Assuming cross-repo scope from same-repo success.** `GH_TOKEN` works on `copilot-autogent/agent-prompt-patterns`. Therefore it will work on `JackywithaWhiteDog/autogent`. It won't — `GH_TOKEN` is scoped to `copilot-autogent/*` only. Cross-repo operations require `GITHUB_API_TOKEN`.

```
Wrong: "the last sprint used this token successfully"
Right: verify the token against the specific repo the current task targets
```

**Treating "no error yet" as confirmation.** The agent has completed steps 1–4 without error. It infers that all capabilities are working. Steps 5–8 haven't run yet — the first one requiring a different token scope will fail.

```
Wrong: "no errors so far, capabilities must be available"
Right: verify explicitly before the first irreversible step, regardless of how far the task has progressed
```

**Running the gate after irreversible steps.** A branch was created, a file was edited, a PR was opened — then the capability manifest was checked. The partial work now requires cleanup even if the task halts here.

```
Wrong: check capabilities partway through the task
Right: the gate runs at task intake, before any external mutation
```

**Over-gating reversible operations.** Every individual tool call is wrapped in a preflight check. The overhead accumulates; simple tasks take 3× as long. Gate fatigue causes agents to skip the gate on genuinely high-risk tasks.

```
Wrong: run the gate before every tool call
Right: run the gate once at task intake, against the full capability manifest for the task
```

## Related Patterns

- **`subprocess-env-scope-verification`** — detailed guidance on the specific PID1 → subprocess propagation boundary; the pre-flight gate calls into this pattern for subprocess-context token probes.
- **`graceful-capability-degradation`** — handles capability failures that occur *after* the gate (mid-task, unexpected failures). The pre-flight gate and graceful degradation are complementary: the gate prevents known-at-intake gaps from causing mid-flight damage; graceful degradation handles unanticipated capability loss.
- **`tool-error-triage`** — classifies tool errors after they're returned. Used inside the pre-flight gate to classify probe failures (transient vs permanent, recoverable vs blocker).
- **`uncertainty-gated-irreversible-action`** — applies a verification gate immediately before a specific irreversible action. The pre-flight gate applies earlier and more broadly (task intake, all capabilities at once); the uncertainty gate applies immediately before the irreversible step itself. Both gates are valuable; they operate at different points in the task lifecycle.
- **`bounded-autonomy`** — defines when agents should escalate vs proceed autonomously. The pre-flight gate surfaces the escalation signal earlier: a capability gap at intake is a cleaner decision point than a mid-flight failure.
