---
title: "Constraint Falsification Before Planning"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Before any 'I can't do X' conclusion becomes load-bearing in a plan, attempt the positive end-to-end. Testing a proxy for absence (e.g., 'which g++' returns nothing) is not the same as testing the capability itself (e.g., running the binary). A false 'blocked' premise silently propagates through every dependent plan item — and the cost scales with how much is built on it."
relatedPatterns: ["empirical-validation-loop", "decision-ownership", "pre-commit-planning-phase", "bounded-autonomy"]
tags: ["autonomy", "planning", "falsification", "blocked", "capability-check", "verification", "premises", "environment", "toolchain"]
---

## Problem

An agent needs to determine whether a capability is available — say, whether a game engine can be run in the current environment. It runs `which g++`. No compiler. It concludes: "can't run engine" → files 5 dependent issues (CI workflow, deferred feature, complete capability reframe) and builds an elaborate workaround roadmap.

`printf 'usi\nquit\n' | /usr/local/bin/yaneuraou` → `id name YaneuraOu NNUE 8.60git 64AVX2`

The engine was prebuilt and bundled. The compiler absence was irrelevant. An entire constraint tree — and the plan built on it — was false.

**Three compounding failure modes:**

1. **Testing a proxy for absence, not the capability itself.** `which g++` tests one way to obtain an engine (compile from source). Its absence doesn't imply the capability is unavailable. Prebuilt binary, package install, remote API, and already-bundled artifact are all independent sufficient conditions — any one of them suffices. Absence of one sufficient condition proves nothing.

2. **Anchoring on "blocked" and building upward.** Once a constraint is accepted, every dependent plan item inherits it without re-verification. The wrong premise silently propagates — and the cost scales with how many items are built on it.

3. **Theorizing instead of reading the authoritative source.** Multiple turns spent hypothesizing "how was X provisioned?" when the Dockerfile/README/config documented the actual capability directly. One `cat Dockerfile` beats three turns of hypotheses.

## Context

This pattern applies whenever an agent:

- Plans multi-step work with explicit or implicit dependency chains
- Encounters tool, environment, or API limitations
- Concludes "blocked," "not available," or "I can't do X" before actually attempting the action
- Is about to build ≥1 plan item on an unverified capability premise

It is particularly important for: toolchain availability checks, API capability probes, environment setup verification, and any scenario where a "blocked" conclusion would reroute significant subsequent work.

**Do not apply this pattern to:**
- Situations where the failure mode is clearly not a proxy-absence error (e.g., HTTP 401 on an authenticated API is not a proxy for authentication capability — it is direct evidence)
- Trivial checks where the cost of being wrong is negligible (no plan items depend on the conclusion)

## Solution

**Before any "I can't do X" conclusion becomes load-bearing, attempt the positive end-to-end.**

### Step 1 — Attempt the positive, directly

Try to DO X, not a prerequisite or sufficient-but-not-necessary condition for X:

```
# BAD — tests one sufficient condition; absence doesn't prove X is unavailable
which g++

# GOOD — directly tests the capability
printf 'usi\nquit\n' | /usr/local/bin/yaneuraou
curl -s https://api.example.com/ping
python -c "import target_library; print('available')"
```

The test must be end-to-end: it should exercise the actual capability, not a prerequisite.

### Step 2 — Read the authoritative source before theorizing

When in doubt about what's available in an environment:

```
# Check the Dockerfile for installed binaries
cat Dockerfile | grep -E '(RUN|COPY|ADD)' | grep -v "#"

# Check the README for capabilities
grep -i "available\|installed\|prebuilt\|bundled" README.md

# Check environment for existing binaries
ls /usr/local/bin/ | head -20
ls /usr/bin/ | grep -i target
```

One `cat Dockerfile` is faster and more reliable than three turns of hypotheses. The authoritative source (Dockerfile, README, `.tool-versions`, `package.json`) reflects the actual environment; speculation does not.

### Step 3 — Label load-bearing premises before building

When a capability claim gates ≥1 plan item, mark it explicitly as load-bearing and verify it before constructing the dependent structure:

```
PREMISE (load-bearing): [capability] is NOT available in this environment.
Verification needed BEFORE building on this: [specific command or check]
Status: UNVERIFIED — do not file dependent issues until verified.
```

After verification:
```
PREMISE (load-bearing): [capability] is NOT available.
Verified by: [command run] → [output]
Dependent plan items: [N items may proceed]
```

### Step 4 — Apply MORE skepticism to "blocked," not less

Accepting a limitation feels productive — it produces a clear path forward (the workaround). Falsifying it takes 30 seconds. This asymmetry is dangerous: the 30-second test that falsifies a false constraint is far cheaper than the 5-issue roadmap built on it.

**Decision rule:** Before treating any "blocked" conclusion as load-bearing, ask: "What single command would prove this wrong?" If you can answer that question, run the command.

## Evidence

**YaneuraOu incident (2026-06):**

Agent ran `which g++` → no compiler found → concluded "can't run shogi engine" → filed 5 dependent issues (CI workflow redesign, deferred features, capability reframe, alternative architecture, timeline revision).

Direct falsification: `printf 'usi\nquit\n' | /usr/local/bin/yaneuraou` → `id name YaneuraOu NNUE 8.60git 64AVX2`.

The engine was prebuilt and bundled in the Dockerfile. The entire constraint tree — and the roadmap built on it — was based on a false premise. The false root premise had silently propagated through ~5 issues before being caught.

**Cost breakdown:**
- Time spent building the false constraint tree: multiple turns across 5+ issues
- Time to falsify: 30 seconds (one command)
- Recovery: all 5 dependent issues required reassessment; 3 needed to be closed

**Pattern generalization:**

The same error class appears whenever an agent tests a sufficient-but-not-necessary condition for a capability:

| False proxy test | What was actually being checked | What should have been checked |
|---|---|---|
| `which g++` | Can I compile from source? | Can I run the engine? |
| `which ffmpeg` | Is ffmpeg installed at a standard path? | Can I process video? (`ffmpeg -version`) |
| `pip show pandas` | Is pandas in the venv? | Can I import pandas? (`python -c "import pandas"`) |
| HTTP 404 on endpoint A | Is feature A available? | Is the feature available via endpoint B or a different API version? |

In each case, the proxy absence proves nothing about the actual capability.

**Documented in PLAYBOOK rule** (June 2026): "Falsify 'Can't / Blocked' Claims by ATTEMPTING the Capability — Not Testing a Proxy for Its Absence."

## Tradeoffs

**Benefit:** Prevents entire roadmaps from being built on false premises. The fix cost is a 30-second command; the miss cost is N plan items built on a false constraint.

**Cost:** Requires resisting the "productive" feeling of accepting a constraint and routing around it. "Can't" feels resolved; it closes the question. Re-opening a closed question feels like backtracking.

**Watch out for:**

- **Confident-sounding proxies**: `which g++` returns a clear, readable output — "nothing found." That confidence makes it *easier* to mistake a proxy absence for capability absence. High-confidence proxy tests are more dangerous than ambiguous ones.

- **The authoritative source isn't authoritative**: Dockerfile, README, and config files can be out of date. After reading the authoritative source, still run the end-to-end verification. The source tells you where to look; the test tells you whether it's there.

- **"Can't" cascades in multi-agent systems**: In a system where Agent A reports "capability X is unavailable" and Agent B plans based on that report, the false premise transfers across agents. Each agent in the chain inherits the false constraint without independent verification. Require end-to-end verification at every agent boundary, not just at the source.

- **Sunk-cost resistance to falsification**: After building 3 plan items on a blocked premise, agents are less likely to question it — the cost of being wrong has grown. This is exactly backwards: the more has been built on a premise, the MORE urgently it should be verified, not less.

## Related Patterns

- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — validates conclusions with direct measurement; Constraint Falsification applies the same discipline specifically to capability claims before plans are built on them.
- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — separates planning from execution; Constraint Falsification belongs in the planning phase — verify all load-bearing capability premises before committing to a plan structure.
- **[Decision Ownership](/agent-prompt-patterns/patterns/decision-ownership)** — defines how agents own and act on decisions; a decision built on a false premise transfers the wrong ownership. Constraint Falsification ensures the premise is sound before ownership is assigned.
- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — defines what agents can decide without human input; capability checks are exactly the kind of claim that should be self-verified, not escalated. Constraint Falsification defines how to self-verify before concluding a capability boundary exists.
