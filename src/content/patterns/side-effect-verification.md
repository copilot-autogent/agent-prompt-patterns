---
title: "Side-Effect Verification"
category: "reliability"
evidenceLevel: "strong"
summary: "Tools that produce external side effects — file sends, notifications, commits, API calls — can fail silently by returning an error string rather than throwing. Agents trust return values and log success while the intended effect never happened. Explicitly verify the observable outcome for any operation where 'it worked' means something changed in the world, not just a string was returned."
relatedPatterns: ["pre-commit-planning-phase", "observer-actor-separation", "sprint-continuity"]
tags: ["reliability", "verification", "silent-failure", "side-effects", "tools", "error-handling", "debugging"]
---

## Problem

An agent calls a tool, receives a response, logs "✅ done", and moves on. The file was never sent. The notification never arrived. The commit was never pushed.

Three failure signatures:

**String-as-error**: The tool returns a human-readable error description — `"File sending is not available in this context"` — instead of throwing an exception. The LLM cannot reliably distinguish this from a success message. It often matches the ✅ mental model and is logged accordingly.

**Partial success**: A tool completes its core operation but silently skips a step. `git pull` updates the local branch but doesn't warn that the remote diverged. `npm test` passes but swallows unhandled promise rejections that would fail in CI. The operation "succeeded" by the tool's own accounting while producing the wrong outcome.

**Deferred failure**: The tool call succeeds synchronously but the side effect happens asynchronously (or not at all). An agent sending a file to Discord receives `undefined` (Promise resolved) while the Discord API request failed silently in a fire-and-forget path. No error propagates.

All three produce the same agent behavior: confident forward progress on a foundation that has already cracked.

## Context

This pattern applies whenever an agent performs an operation whose success criterion is a *change in state outside the tool's return value*:

- **Discord/messaging tools**: `send_file`, `send_message`, `post_to_channel` — did the message actually appear?
- **Version control tools**: `git push`, `git commit`, `git pull` — did the remote state change?
- **Build/test tools**: `npm test`, `npm run build` — did CI-equivalent checks pass?
- **Memory/storage tools**: `save_memory`, `write_file` — does the persisted state match what was written?
- **External API calls**: Any operation where the API could return 200 with an embedded error body

The pattern is especially important in multi-agent pipelines where one agent's "done" is the next agent's input. Silent failures compound: if Agent A's `send_file` fails silently and Agent B is waiting for the file, you get a cascade of confusing downstream failures rather than a clear root-cause signal.

## Solution

**Design for the observable outcome, not the return value.**

Three concrete strategies:

**1. Verify, don't assume**

After any external side-effect operation, perform a follow-up check against a ground truth that doesn't depend on the tool's own return value:

- After `git push`: run `git log origin/main --oneline -1` and confirm the expected commit appears
- After `npm run build`: run `grep "key_change" dist/path/to/file.js` to confirm the change compiled in
- After `save_memory`: immediately `recall_memory` the topic and check the expected content is present
- After posting to an API: query the resource back and confirm the expected state

This is the "read your writes" principle from distributed systems applied to agent pipelines.

**2. Use exit codes and exceptions, not strings**

When writing tool handlers, prefer exceptions over error strings for failures. A tool that throws `new Error("send_file: channelId not available")` forces the agent to handle the error explicitly. A tool that returns `"File sending is not available in this context"` creates a string the LLM may or may not recognize as failure.

For tools you don't control, add a thin wrapper that inspects the return value and throws if it looks like an error:

```
result = await send_file(path)
if result.startsWith("Error") or result.startsWith("File sending"):
    throw Error(f"send_file failed: {result}")
```

**3. Distinguish CI-equivalent from developer-mode execution**

Some tools have a "developer-mode" variant that passes while hiding failures that would surface in production:
- `npm test` vs `npm run test:coverage` (coverage mode surfaces unhandled rejections)
- `git pull` vs `git fetch && git reset --hard origin/main` (reset removes silent divergence)
- Ephemeral tool stubs that return `undefined` in test vs real Discord API calls in prod

When writing prompts for agents, specify *which variant* to use. "Run the tests" is ambiguous; "Run `npm run test:coverage` and confirm exit code 0" is not.

**Prompt template for side-effect operations:**

```
After [operation X], verify it succeeded by [specific check].
Do not proceed to [next step] until [specific observable] confirms success.
If verification fails, treat it as a hard failure and stop.
```

## Evidence

Multiple production incidents in an autonomous multi-agent system provide direct evidence across all three failure categories:

**String-as-error (BUG-5, May 2026)**: A spawned agent's `send_file` calls returned `"File sending is not available in this context"` because `toolContext.channelId` and `toolContext.sendFileToChannel` were never wired in ephemeral sessions. Agents logged `"✅ send_file done"` for every call. Files never reached Discord. The bug was discovered by user observation, not by the agents themselves. Fix required code changes in the session wiring layer. Total undetected duration: ~2 weeks across multiple sprint agents.

**Partial success (git pull divergence)**: A session update using `git pull` that appeared to succeed left the local branch diverged from origin. Subsequent builds compiled old code. The visible behavior ("pull completed") masked the actual state. The PLAYBOOK was updated to require `git fetch origin main && git reset --hard origin/main` for all workspace syncs. The distinguishing factor: `reset --hard` makes the target state explicit; `pull` leaves the resolution to merge heuristics.

**Deferred failure (npm test vs npm run test:coverage)**: Unhandled promise rejections in test code produced exit code 0 from `npm test` but exit code 1 from `npm run test:coverage`. CI used coverage mode; local pre-push checks used plain `npm test`. Result: 5 consecutive PRs failed CI despite "all tests passing" in local verification. After the rule was documented as "always use `test:coverage` before push", zero recurrences.

**Post-merge compile verification**: After merging a PR, agents would declare the change "active" without verifying the new code was present in the compiled output. The `dist/` directory could contain stale compiled code from a previous build. The practice of `grep`-ing for the key change in `dist/` after every `npm run build` was added after two incidents where stale code caused confusing behavior.

## Tradeoffs

**Benefit**: Silent failures surface immediately rather than compounding through subsequent steps. Debugging time shifts from "why did everything downstream go wrong?" to "why did this specific step not produce its observable outcome?"

**Cost**: Each verification step adds latency and tool calls. In a tight session budget ([Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)), verification competes with productive work. The test: what's the cost of the downstream confusion when this particular failure goes undetected? For high-stakes operations (PR merge, file delivery, production data write), verification cost is almost always worth it. For low-stakes idempotent reads, skip it.

**Watch out for:**
- **Verification that re-uses the same failure mode**: Verifying `send_file` succeeded by calling `send_file` again tests the same broken path. Verification must use an *independent* channel — check the inbox, query the API, read the filesystem directly.
- **Over-verification creating brittleness**: Verifying every tool call at microsecond granularity makes prompts rigid and hard to update. Apply verification to *external side effects* and *irreversible operations*, not to every intermediate computation.
- **String-matching on error messages**: Wrapping tools by checking for `result.startsWith("Error")` is fragile. Prefer checking for expected success indicators over expected failure indicators — they're more stable.

## Related Patterns

- **[Pre-Commit Planning Phase](/agent-prompt-patterns/patterns/pre-commit-planning-phase)** — verification checkpoints fit naturally into the "gate before commit" moment; the planning phase can include explicit "does this operation need a verify step?" questions
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the "observer" role in a pipeline is well-positioned to independently verify what the "actor" claimed to do; separating observation from action makes verification structurally natural
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — a manifest that records "shipped PR #7 at commit abc123" enables the next sprint to verify the claim independently; without the reference, verification requires re-reading all logs
