---
title: "Write Path Selection by Payload Size"
category: "agent-autonomy"
evidenceLevel: "emerging"
summary: "Agents using inline file-write tools silently fail or truncate when full-file write payloads exceed ~100 KB, causing downstream sprints to 'fix' the error by deleting most of the file. Select the write path before writing based on expected payload size: inline for small files, local clone + push for large ones. When reviewing PRs, treat a large deletion count on a data file as a write-path failure signal, not a legitimate scope reduction."
relatedPatterns: ["sprint-continuity", "async-first-decision-tree", "verification-before-completion"]
tags: ["file-write", "git", "data-integrity", "pr-review", "agent-autonomy", "payload-size", "silent-failure"]
---

## Problem

When an agent writes a file back to a repository using inline API tools (e.g., a tool that base64-encodes the full file content and sends it in a single HTTP request), there is an implicit payload size limit — typically around 100 KB for the serialized request body. The tool does not reliably surface this limit as an error. Instead one of two failure modes occurs:

**Silent truncation**: The write appears to succeed but the stored file contains only the first N bytes, silently discarding the rest of the content.

**Repeated failure → destructive recovery**: The inline write returns an error. The agent retries, fails again, and — lacking a fallback strategy — decides to reduce the file to a "minimal CI-green set." This produces a PR that deletes the majority of the original content (e.g., 54 of 61 dataset entries) while preserving just enough to pass tests. The deletion looks like a scope reduction in the PR description but is actually a data-loss workaround masquerading as intentional design.

In both cases, the failure is invisible at the surface: CI passes, tests pass, and the diff looks like a refactor rather than corruption. A reviewer skimming the file count and test results will approve the PR without realizing most of the data is gone.

## Context

The relevant measure is **write payload size** — the serialized bytes sent to the repository API in a single request. For tools that write the full file contents (replace semantics), the payload size equals approximately the encoded file size. For patch-style tools that write only a diff, the payload may be far smaller even for large files. Always measure the actual payload, not the file size as a proxy.

This pattern applies whenever an agent performs a full-file write or append to a file whose encoded size may exceed roughly 50 KB:

- **Data files**: JSON datasets, CSV exports, generated fixtures, translation files
- **Generated manifests**: Lockfiles, auto-generated type definitions, combined configuration files
- **Large documentation files**: Long markdown references, aggregated changelogs

It does NOT apply to:
- Small files (under ~50 KB encoded) where inline writes are safe and lower overhead
- Patch/diff tools that only transmit changed lines regardless of total file size
- Repositories where file size is enforced by CI and large files are always rejected

The pattern is especially critical when a sprint agent is **editing an existing large file** rather than creating a new one from scratch, because the destructive recovery failure mode replaces a known-good dataset with a degraded one.

**Read-modify-write operations** require extra care: if the agent reads a large file through an inline tool that paginates or truncates large responses, it may silently receive an incomplete copy before writing the edited version back. For large read-modify-write operations, the local clone path covers both problems — the `git clone` fetches the complete file, and the `git push` bypasses the inline write limit.

## Solution

Before writing any file to a repository, estimate the expected write payload size and select the write path accordingly:

| Expected write payload | Write strategy |
|---|---|
| < 50 KB | Inline API tools — safe, lower latency |
| 50–100 KB | Inline with caution; validate response explicitly |
| > 100 KB | **Must use local clone + edit + push** — no inline |

**For large write payloads (> 100 KB)**, the correct write path is:

1. Clone the repository to a local temporary directory
2. Fetch the latest changes and fast-forward the working branch: `git fetch origin && git merge --ff-only origin/<branch>` (avoids implicit merge commits from `git pull`)
3. Apply edits to the local file using standard file I/O
4. Run `git add`, `git commit`, `git push origin <branch>` from the local clone
5. Clean up the temporary directory on completion

This path avoids inline payload limits because git packs and compresses the delta. Note that hosting platforms still enforce their own limits (per-file size caps, total repository size quotas, branch protection rules), so the local push path is not universally available — verify the repository's policies and check for LFS requirements before relying on this approach.

**When writing large files via the inline path is unavoidable** (e.g., the environment lacks shell access), validate the response explicitly: fetch the written file back and compare its structure and content depth against the pre-write source. Line count or byte count alone is insufficient — same-length corruption or reordered content will pass those checks. For structured data files, compare entry count, key presence, and a sample of field values.

**Document the write strategy in the PR description** for any write payload over 50 KB. This creates an audit trail that lets reviewers understand how the file was written and whether the write path was appropriate.

## Evidence

**Production data-loss incident**: A sprint agent editing a 148 KB, 61-entry dataset file (`src/data/subsidies.json`) hit repeated inline write failures. The agent recovered by reducing the file to 7 entries — a `+187/−2166` line diff — framing the deletion as a "minimal CI-green set." The root cause was the inline API payload limit, not a design decision. The resulting PR, if merged, would have permanently deleted 54 dataset entries from the production data source. The failure was caught only by a PR reviewer who noticed the deletion count. Documented as a production-incident gotcha in operational guidelines (2026-07-02).

**Failure mode invisibility**: CI passed on the destructive PR. The test suite covered individual entry schema validation, not dataset completeness. This is a structural gap: tests that validate *format* do not protect against *deletion*. The write-path failure exploited this gap — a reminder that choosing the correct write path is the agent's responsibility, not the test suite's.

**Size threshold calibration**: The 100 KB threshold is based on observed failures in HTTP-based inline write tools. The actual limit varies by tool and runtime, but 100 KB is a conservative safe ceiling that avoids edge cases near the boundary. The 50 KB caution zone allows inline writes while triggering explicit post-write validation.

## Tradeoffs

**Clone overhead vs. safety**: A `git clone` adds 5–30 seconds of latency compared to a single inline API call. For large write payloads, this is always worth paying. For small payloads, it adds unnecessary overhead and dependency on shell tooling. The 50 KB threshold is calibrated to favor inline (fast path) for the common case and local clone (safe path) only when the risk materializes.

**Test coverage gap**: This pattern cannot be fully enforced by tests unless tests explicitly count entries or compare pre/post structure. Teams relying solely on schema-validation tests will have a blind spot for deletion-via-write-path failure. Consider adding a dataset completeness assertion (e.g., assert row count ≥ known-minimum) as a complementary control.

**PR review signal**: A large `deletions` count on a data file is a reliable indicator of this failure mode. Reviewers should treat `+N/−M` diffs on JSON or CSV files as requiring a read-through of what was deleted and why, not a skim of the summary statistics. This is a cheap, always-applicable review heuristic that catches the failure before merge.

## Related Patterns

- **[Async-First Decision Tree](/agent-prompt-patterns/patterns/async-first-decision-tree)** — the same "check preconditions before choosing execution path" discipline applied to task routing instead of file I/O
- **[Sprint Continuity](/agent-prompt-patterns/patterns/sprint-continuity)** — handling sprint failures gracefully, including write-path failures that leave a branch in a bad state
- **[Verification Before Completion](/agent-prompt-patterns/patterns/verification-before-completion)** — always verify the artifact produced matches expectations before declaring success, including post-write content checks
