---
title: "Dedup-Search Before Autonomous Issue Filing"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Before filing any new issue in an autonomous cron, perform at minimum one keyword search against open AND closed issues. Without a dedup check, agents refile already-resolved items after memory loss, produce same-concept duplicates with different titles, and cause cross-cron collisions — each variant wastes a full sprint cycle on already-shipped work."
relatedPatterns: ["strategic-recall-before-ideation", "constraint-falsification", "circuit-breaker"]
tags: ["autonomy", "deduplication", "issue-filing", "backlog", "search", "idempotency", "cron", "memory-loss"]
---

## Problem

An autonomous ideation agent detects a need — low backlog, new pattern insight, newly-observed failure mode — and files a new issue. Without a deduplication search, it files an issue that already exists under a different title, or one that was resolved and closed weeks ago.

Four failure variants:

**Same concept, different title**: "Structured Handoff Header" and "Agent Dispatch Context Block" describe the same pattern. Both get filed. Both get sprinted. One sprint's output becomes dead code — the feature already landed under the other issue's PR.

**Reopened closed items**: A workspace wipe or memory loss event causes the ideation cron to "rediscover" already-resolved issues. The pattern was shipped in a sprint three weeks ago; the agent has no memory of this and refiles it. A new sprint reinvents work that already exists in `main`.

**Cross-cron collision**: Two independent crons (an ideation cron and a monitoring cron) both identify the same gap on the same day. Each files independently. Neither searches for the other's issue. Two sprints run in parallel; the second one merges dead code on top of the first.

**Closed issue resurrection**: The agent filters its search to `is:open`. The issue it's about to file was closed six weeks ago. The `is:open` filter hides it entirely. The agent concludes "never filed" and creates a duplicate.

Each variant wastes a full sprint cycle. The cost is not just compute — it is the follow-up cleanup: closing duplicate issues, reverting dead code, reconciling conflicting implementations, and explaining to downstream dependents why two versions of the same thing exist.

## Context

This pattern applies to any autonomous agent that creates backlog items — GitHub issues, Jira tickets, linear tasks, or any other structured work items — without direct human review before filing.

It is most critical when:

- The same backlog is shared by multiple independent crons or agents
- The agent's memory can be wiped or lost (workspace reset, container restart, context limit)
- Issues use free-form titles where the same concept can be described multiple ways
- The agent files after any memory-loss event (startup, restart, or a prior session that didn't complete)

The pattern does NOT apply to:
- **Human-initiated issue filing** — humans carry context; dedup is a judgment call, not a mandatory gate
- **Inherently unique event-triggered issues** — "CI failed on PR #42" is tied to a specific event and is not a duplicate of any earlier issue

## Solution

**Before filing any autonomously-generated issue, run at minimum one keyword search against both open and closed issues.**

### Step 1 — Extract 2–4 search keywords

From the proposed issue title and concept, extract the fewest words that uniquely identify the core idea. Avoid stop words. Prefer specific domain terms over generic ones.

```
# For a proposed issue "Dedup-Search Before Autonomous Issue Filing"
Keywords: "dedup", "duplicate", "issue filing", "search before"
```

When the concept can be described multiple ways, generate two independent keyword sets representing different phrasings of the same idea.

### Step 2 — Search open AND closed issues

Always use a state-agnostic query. Never use `is:open` alone.

```
# BAD — misses closed duplicates
search: is:issue is:open "handoff header"

# GOOD — catches both open and closed
search: is:issue "handoff header"
search: is:issue "dispatch context block"
```

Run both searches before making a filing decision.

### Step 3 — Inspect matches and determine closure disposition

When a matching closed issue is found, read it to determine whether refiling is appropriate. GitHub issues expose a `state_reason` field in the API with three values: `completed` (work was done), `not_planned` (declined or won't fix), and `duplicate` (superseded by another issue). Labels and the issue body carry additional context.

| Signal | Decision |
|--------|----------|
| Same concept, same title | **Skip** — exact duplicate |
| Same concept, different title (keyword overlap ≥ 50%) | **Skip** — semantic duplicate |
| Closed issue, `state_reason: completed` | **Skip** — already shipped; check whether a PR was merged and exists in `main` |
| Closed issue, `state_reason: not_planned` | **Read closure notes** — if reason still applies, skip; if context changed, consider refiling with explicit reference to the prior closure |
| Closed issue, `state_reason: duplicate` | **Follow the duplicate chain** — find the canonical issue and check its status |
| Closed issue, `state_reason` absent (legacy) | **Read issue body and labels** for "won't fix", "completed", or "by design" signals |
| Complementary concept (same category, different problem) | **File** — not a duplicate |
| No matches in either search | **File** — likely novel |

"Keyword overlap ≥ 50%" means: if you list the 4 core concepts implied by both titles, at least 2 are the same concept (even if different words). Use judgment on meaning, not string matching.

> **Checking `state_reason` in practice**: When searching via the GitHub search API, results include `state` (open/closed) but not `state_reason`. For any matching closed issue, call `github-issue_read method=get` on that specific issue number to retrieve `state_reason` before making the skip/file decision. The search result alone is not sufficient — one extra API call is required per matched closed issue.

### Step 4 — Include dedup evidence in the filed issue

Every autonomously-filed issue must include:
- **Keywords used in dedup search** (proves the check ran)
- **Date filed and filing agent identity** (for traceability across memory-loss events)
- **Relationship to existing issues** — even if "none found"

```markdown
---
*Filed by: [agent name], [ISO date]*
*Dedup search performed: queries ["[keyword set 1]", "[keyword set 2]"] returned no matching open or closed issues.*
```

If issues were found but judged non-overlapping, list them:
```markdown
*Related but distinct: #12 (Circuit Breaker for Recurring Tasks) — same autonomy category, different problem statement.*
```

### Prompt template

```
## Before filing this issue:

1. Extract 2–4 keywords from the proposed title/concept.
2. Run two searches using different keyword phrasings:
   - Search 1: github-search_issues query="[keyword set 1]" owner=OWNER repo=REPO
   - Search 2: github-search_issues query="[keyword set 2]" owner=OWNER repo=REPO
   (Do NOT add is:open — search open and closed issues.)
3. If total_count >= 1: inspect titles for semantic overlap.
4. If meaningful overlap: call github-issue_read method=get on the matching issue to
   check state_reason (completed / not_planned / duplicate). Apply the judgment table above.
5. If no overlap, or all matches are judged non-overlapping: proceed to file.
6. In the filed issue, include:
   - The keywords you searched
   - Any issues found and why they were judged non-overlapping (or "none found")
   - The date and agent identity
```

## Evidence

**Post-wipe risk quantification (2026-06-28)**: After a workspace wipe, 3 separate autonomous agents ran on 3 separate projects within 24 hours. The ideation cron explicitly runs a dedup search via `github-search_issues` before each filing. Without this guard, an estimated 8–12 duplicate issues would have been filed across repos — the backlog state at time of wipe contained patterns the agents would have "rediscovered."

**Cross-project dedup guard results**: Similar dedup guards in `subsidy-radar` and `realestate-radar` ideation crons have prevented at least 4 confirmed duplicate filings (identified in channel logs). In each case, the agent performed the search, found a matching closed or open issue, and skipped filing.

**Open+Closed search gap**: In one documented case, an agent searched `is:open` only. The issue it was about to file had been implemented and closed 18 days earlier under a slightly different title. The open-only search returned 0 results. The state-agnostic search returned the closed issue within 3 seconds, blocking the duplicate.

**Cross-cron collision (2026-06-29, issue #741)**: Two monitoring crons independently identified the same audit gap and each filed issues. The dedup check was absent from one cron. Result: 6 duplicate issues (#764–769) filed within 4 hours, requiring manual dedup and closure. Dedup search on the second cron's keywords would have found the first cron's issues and blocked 5 of the 6 filings.

## Tradeoffs

**Benefit**: Eliminates duplicate sprint cycles entirely. The search cost is 1–2 API calls (under 5 seconds), plus one extra `get` call per matching closed issue. The cost of a missed duplicate is a full sprint cycle (15–60 minutes) plus PR cleanup, dead code removal, and issue management overhead.

**Cost**: Adds a mandatory pre-filing step that slows down the filing decision slightly. In high-throughput ideation agents, this adds 2–5 seconds per proposal. Acceptable in all measured cases.

**Watch out for**:

- **Open-only search as a false shortcut**: `is:open` is faster to type and feels sufficient. It silently misses all closed issues. Make the state-agnostic query the default; open-only is never the correct default for dedup checks.

- **Keyword specificity trap**: Keywords that are too generic ("pattern", "agent", "task") return hundreds of results and make the dedup check useless. Keywords that are too specific ("dedup-search-before-filing") may miss semantic duplicates. Use 2–3 mid-specificity domain terms — specific enough to narrow results, broad enough to catch title variations.

- **Multi-keyword coverage**: A single search misses title variations. "Structured handoff" and "agent dispatch context" describe the same thing. Use at least two independent keyword sets representing different phrasings of the same concept. If both return 0 results, the concept is likely novel.

- **Trusting 0 results too quickly**: A search returning 0 results is evidence the exact query wasn't matched — it is not proof the concept doesn't exist. Run a second search with a different phrasing before concluding "no duplicate found."

- **`state_reason` requires a second API call**: GitHub's search results include `state` (open/closed) but not `state_reason`. Skipping the per-issue `get` call means applying the judgment table without the key field it depends on. Budget one `get` call per matched closed issue.

- **`state_reason` absent on legacy issues**: Issues closed before GitHub introduced `state_reason` (or via integrations that don't set it) may return `null`. In that case, fall back to reading labels (`wontfix`, `resolved`, `by-design`) and the closing comment to infer disposition.

## Related Patterns

- **[Strategic Recall Before Ideation](/agent-prompt-patterns/patterns/strategic-recall-before-ideation)** — mandates recalling synthesis memory (internal) before generating proposals; Dedup-Search is the external equivalent — recalling existing issues before filing them. The two patterns compose: recall memory for strategic direction, search issues for dedup, then file.
- **[Constraint Falsification Before Planning](/agent-prompt-patterns/patterns/constraint-falsification)** — falsifies capability assumptions before building plans on them; Dedup-Search applies the same falsification discipline to the assumption "this hasn't been filed yet" before committing to filing.
- **[Circuit Breaker for Recurring Agent Tasks](/agent-prompt-patterns/patterns/circuit-breaker)** — auto-disables tasks that produce repeated low-value output; Dedup-Search prevents a specific failure mode the circuit breaker can't detect — a task that successfully files issues, but files duplicates that each look like novel value on the surface.
