---
title: "Subprocess Environment Scope Verification"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Environment variables present in the parent/PID1 process are NOT automatically propagated to spawned bash subprocesses. An agent that reads an env var from a subprocess may silently see it as empty — even though it exists in the parent — and then incorrectly diagnose an auth failure, waste turns on token debugging, or write misleading root-cause notes into persistent memory. Verify env vars in-scope (in the actual subprocess context), prefer MCP/tool-layer auth over subprocess shell calls, and falsify before escalating."
relatedPatterns: ["constraint-falsification", "empirical-validation-loop", "bounded-autonomy", "decision-ownership", "tool-error-triage"]
tags: ["environment", "subprocess", "auth", "tokens", "credentials", "scope", "falsification", "debugging", "bash", "propagation"]
---

## Problem

An agent needs to call the GitHub API from a bash subprocess. It constructs a `curl` command using `$GITHUB_API_TOKEN`. The request fails with a 401. The agent concludes: "the token is missing from the container" → writes a CONTEXT.md gotcha claiming "GITHUB_API_TOKEN missing from container" → other agents read this and route around subprocess auth for weeks.

Meanwhile, `GITHUB_API_TOKEN` was present in PID1 the entire time — it simply was not propagated to spawned bash subprocesses. The MCP GitHub tools continued to succeed using their own server-level auth throughout.

**The root failure: diagnosing environment scope without checking environment scope.**

An empty `$GITHUB_API_TOKEN` in a bash subprocess is NOT evidence that the token is absent from the container. It is evidence that the token is absent from _that subprocess's environment_ — which may be a distinct propagation boundary from the parent process.

**Three compounding failure modes:**

1. **Diagnosing parent env from subprocess symptoms.** A subprocess sees an empty var → agent concludes the var is absent from the entire container. This conflates two different scopes: the subprocess env and the parent/PID1 env.

2. **Escalating before falsifying.** The agent treats the 401 as confirming the token-absence hypothesis without checking (a) whether the token exists at PID1 and (b) whether the failure is actually in the tool layer vs the subprocess. A single check of `${GITHUB_API_TOKEN:-}` in the subprocess context would have surfaced the propagation boundary immediately.

3. **Writing incorrect causal claims into push-files (CONTEXT.md).** A diagnosis written under uncertainty becomes "received knowledge" — it shapes how every subsequent sprint agent debugs the same issue. A false cause in a push-file propagates to every future session.

## Context

This pattern applies whenever an agent:

- Runs shell commands (`curl`, `gh`, custom scripts) that depend on env vars
- Encounters auth failures in subprocess-level tool calls
- Is about to escalate "token missing from container" based on subprocess behavior
- Is about to write a diagnosis into a persistent push-file (CONTEXT.md, memory, persistent notes)
- Differences in behavior between tool-layer calls (MCP) and subprocess calls are observed

**Subprocess scope table (autogent container example):**

| Scope | `GH_TOKEN` | `GITHUB_API_TOKEN` |
|---|---|---|
| PID1 env | ✓ present | ✓ present |
| Spawned bash subprocesses | ✓ present | ✗ **not propagated** |
| MCP GitHub tools | ✓ (uses MCP server token) | ✓ (uses MCP server token) |
| Agent sessions | varies | varies |

The exact propagation rules depend on the container/process setup. The pattern is: **do not assume subprocess env = parent env without checking.**

**Do not apply this pattern to:**
- Genuine container-level secret absence (e.g., the token was never injected into the container at all — verifiable by checking PID1 env directly)
- Tool-layer failures where the MCP/API layer also fails (both subprocess and MCP failing simultaneously is a stronger signal of true credential absence)

## Solution

**Verify in-scope before escalating. Prefer tool-layer auth. Falsify before writing persistent diagnoses.**

### Step 1 — Verify the var in the actual subprocess context

Before concluding a token is absent from the container, check whether it is absent from the _subprocess_. Use shell parameter expansion to test for a non-empty value (safe under `set -e`; set-but-empty is also unusable):

```bash
# Shell parameter expansion — safe under set -e; returns empty string without error if unset
val=${GITHUB_API_TOKEN:-}
[ -n "$val" ] && echo "present and non-empty" || echo "absent or empty"

# To check PID1 env for the same var (presence only; no value printed):
# Note: /proc/1/environ requires root or CAP_SYS_PTRACE — 2>/dev/null swallows
# "Permission denied". The || branch fires for both "absent" and "permission denied" —
# the message reflects this ambiguity explicitly.
cat /proc/1/environ 2>/dev/null | tr '\0' '\n' | grep -q '^GITHUB_API_TOKEN=' \
  && echo "present in PID1" || echo "absent in PID1 (or permission denied)"
# If permission is denied, ask the operator or check via: docker inspect <container>
```

If the subprocess shows absent-or-empty but PID1 shows present, the var exists upstream but is not inherited by this subprocess. This is a propagation boundary — not a credential absence. Note: Unix env inheritance is from the direct parent process, not necessarily PID1 — an intermediate launcher may also have stripped the var intentionally. PID1 presence is a useful diagnostic signal, not a guarantee of child-reachability.

### Step 2 — Prefer MCP/tool-layer auth over subprocess shell calls

Tool-layer calls (MCP GitHub tools, SDK client calls) typically use a dedicated server-level credential, independent of subprocess env propagation. For operations that can be performed via the tool layer, prefer them:

```
# BAD — depends on subprocess env var propagation, fails silently if var not inherited
curl -H "Authorization: token $GITHUB_API_TOKEN" https://api.github.com/repos/owner/repo

# GOOD — uses MCP server auth, independent of subprocess env
github-get_file_contents owner="owner" repo="repo" path="README.md"
```

When subprocess auth is unavoidable, use shell parameter expansion (not `printenv` or a subshell command) to avoid `set -e` surprises, and guard for emptiness before proceeding:

```bash
# Shell parameter expansion: safe under set -e, no external command
token=${GITHUB_API_TOKEN:-}
if [ -z "$token" ]; then
  echo "ERROR: GITHUB_API_TOKEN absent or empty in subprocess — cannot proceed" >&2
  exit 1
fi
curl -H "Authorization: token ${token}" https://api.github.com/repos/owner/repo
# Note: the token is visible in process listings (ps) on this host.
# For high-sensitivity credentials, prefer operator injection via container secrets
# or a credentials file rather than expanding the token as a command-line argument.
```

### Step 3 — Falsify auth failure attribution before writing diagnoses

When a subprocess call fails with an apparent auth error, apply the falsification sequence before writing the diagnosis anywhere persistent:

```
1. Check subprocess env: val=${GITHUB_API_TOKEN:-}; [ -n "$val" ] && echo "non-empty" || echo "absent/empty"
2. Check PID1 env (diagnostic only):
   cat /proc/1/environ 2>/dev/null | tr '\0' '\n' | grep -q '^GITHUB_API_TOKEN='
   → present in PID1 AND absent/empty in subprocess: propagation boundary (or intermediate stripping)
   → absent in PID1 (or permission denied): ask operator to verify credential injection
3. Verify tool layer: does an equivalent MCP tool call succeed?
   → MCP success: tool-layer auth is working (MCP may use a different server-side credential —
     success here does not confirm the subprocess token exists or is scoped correctly)
   → MCP also fails: stronger signal of genuine credential absence or scope mismatch — escalate
```

Only after completing this sequence should a diagnosis be written into CONTEXT.md, memory, or persistent notes.

### Step 4 — Write scoped, falsified claims in push-files

When a diagnosis must be written into a push-file (CONTEXT.md, memory), scope it accurately to what was observed:

```
# BAD — over-generalizes; treats subprocess observation as container-level fact
"GITHUB_API_TOKEN is missing from the container."

# GOOD — scoped to the observed propagation boundary, with falsification evidence
"GITHUB_API_TOKEN is present in PID1 env but NOT propagated to bash subprocesses.
Confirmed: ${GITHUB_API_TOKEN:-} check in subprocess → empty; PID1 grep → present.
MCP GitHub tools continue to succeed (use MCP server auth). Use MCP tools for GitHub API
calls; do NOT diagnose this as credential absence."
```

A correctly scoped claim prevents future agents from re-deriving the wrong root cause.

## Evidence

**Autogent container incident (2026-07-02):**

Subprocess `$GITHUB_API_TOKEN` appeared empty → agent wrote CONTEXT.md gotcha: "GITHUB_API_TOKEN missing from container." Empirical falsification run shortly after:

- `${GITHUB_API_TOKEN:-}` check in subprocess → empty
- PID1 env check → var present at PID1
- MCP GitHub tools (GraphQL mutations, REST calls): **17 successful calls with 0 auth errors** throughout the same period

The gotcha was corrected with a note: "DO NOT diagnose a symptom as 'token missing from container' — verify PID1 vs subprocess env before escalating." The original misdiagnosis had already been read by at least one sprint agent and influenced its debugging strategy.

**Why the error recurs:**

The `$VAR` expansion in bash is silent — empty string, no error, no warning. An empty var produces a 401 that looks exactly like a missing credential. The agent's debugging path naturally reaches "credential absent" before reaching "credential present but not propagated" because the latter requires knowledge of the subprocess/parent boundary distinction.

**Correction cost:**
- Verification time: ~30 seconds (two shell commands)
- Discovery of root cause: immediate once the PID1 env was checked
- Cleanup required: CONTEXT.md correction + correction note to prevent re-propagation of false diagnosis
- Ongoing drift risk: any sprint that read the incorrect CONTEXT.md before correction may have miscalibrated debugging expectations

## Tradeoffs

**Benefit:** Prevents false diagnoses from entering persistent files where they shape every future sprint's debugging strategy. A correct propagation-boundary diagnosis is also directly actionable (prefer MCP tools; ask operator to inject), whereas "token missing from container" is not directly actionable by a sprint.

**Cost:** Adds one diagnostic step (check PID1 env) before escalating. In the uncommon case where the credential is genuinely absent at PID1, this step adds ~30 seconds before the correct escalation.

**Watch out for:**

- **Silent empty var expansion**: bash silently expands missing vars to empty strings. A missing `$TOKEN` in a `curl` command looks like `Authorization: token ` — a syntactically valid but semantically empty header — and produces a clean 401. Nothing in the error output indicates env var propagation as the cause.

- **`/proc/1/environ` access restrictions**: reading PID1's environment typically requires matching UID or `CAP_SYS_PTRACE`. In many container setups, `cat /proc/1/environ` returns "Permission denied". Use `2>/dev/null` so that permission failures produce empty `grep` input (grep exits non-zero, correctly matching the "absent or permission denied" branch). When `/proc/1/environ` is inaccessible, fall back to `docker inspect` or operator confirmation.

- **PID1 is not the direct parent**: Unix env inheritance flows from the immediate parent process, not from PID1. An intermediate launcher (supervisor, entrypoint script, setsid wrapper) may have intentionally stripped variables. PID1 presence is evidence that the secret was injected into the container, but it does not guarantee it reaches child shells unmodified.

- **`set -e` and subshell commands**: `val=$(printenv VAR)` exits non-zero under `set -e` when VAR is unset, terminating the script before the `[ -n "$val" ]` check. Use shell parameter expansion (`val=${VAR:-}`) instead — it always succeeds regardless of whether the var is set.

- **Credential exposure via argv**: passing a token as a command-line argument (`curl -H "Authorization: token $token"`) exposes it in `ps` output to other processes on the same host. For high-sensitivity credentials, prefer container secret mounting or a credentials file over argv. This concern is orthogonal to the propagation-boundary diagnosis — but avoid introducing it while fixing an auth bug.

- **MCP success ≠ subprocess token existence**: MCP tools use a server-level credential that may be distinct from the subprocess env token, with different scopes. MCP success confirms the operation is reachable at the tool layer; it does not confirm that the same credential exists and is usable in subprocess context.

- **Correcting the push-file but not the spawn-prompt**: If CONTEXT.md is corrected but a task's scheduled prompt still contains the old diagnosis, spawned agents will continue to operate on the incorrect understanding. Corrections must propagate to all places the diagnosis was written.

- **Propagation rules vary by container/setup**: The exact set of vars that are and aren't propagated depends on how the container is configured (env directives, exec vs fork vs setsid, etc.). The specific example (GITHUB_API_TOKEN not propagated, GH_TOKEN propagated) is container-specific. Apply the verification step rather than assuming a specific propagation pattern.

## Related Patterns

- **[Constraint Falsification](/agent-prompt-patterns/patterns/constraint-falsification)** — applies the same falsification discipline to capability claims; Subprocess Environment Scope Verification applies it specifically to env var propagation claims before they enter persistent files.
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — validates conclusions with direct measurement; this pattern specifies the measurement sequence for env scope diagnosis.
- **[Tool Error Triage](/agent-prompt-patterns/patterns/tool-error-triage)** — diagnoses tool-layer failures; Subprocess Environment Scope Verification focuses on the specific class where subprocess env propagation is the root cause rather than credential absence.
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — defines what agents can decide without human input; env scope verification is a self-executable falsification check that should not require escalation.
- **[Decision Ownership](/agent-prompt-patterns/patterns/decision-ownership)** — a diagnosis written into a push-file becomes "owned" by every subsequent agent that reads it; incorrect diagnoses transfer false ownership. Verify before writing.
