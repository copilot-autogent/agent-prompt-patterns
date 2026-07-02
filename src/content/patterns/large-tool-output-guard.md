---
title: "Large Tool Output Guard"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Apply explicit size-limiting strategies before invoking tools that return large output. Agents acting on silently truncated results make decisions on partial data — causing missed items, wrong dedup checks, incomplete manifests, and logic that processes only the first N results."
relatedPatterns: ["context-window-budgeting", "enumeration-first-verification", "parallel-tool-call-batching", "dedup-search-before-filing"]
tags: ["context", "pagination", "truncation", "tool-output", "large-output", "grep", "filtering", "recall-memory", "file-listing"]
---

## Problem

Many tool calls return outputs that exceed context-window budgets or get silently truncated:

- `github-get_file_contents` on a directory returns a 45KB JSON blob listing every file with full metadata
- `recall_memory` on a known-large topic returns a 60KB topic file as a truncated preview
- `github-list_issues` without `perPage` returns the first 30 items and silently omits the rest
- `grep` with a broad pattern returns thousands of matches, the last N of which are dropped

The agent receives a response that appears complete — there is no error, no explicit "more results exist" flag in the visible output — and acts as though it received the full dataset. Downstream decisions are made on partial data:

- Dedup search concludes "not found" after inspecting only the first 30 issues
- Manifest builder lists 12 patterns when 57 exist
- Memory reader applies a `view_range` to a topic that looks complete, but the real insight is in the truncated tail
- File search concludes a module "doesn't exist" because the match is past the grep `head_limit`

Each of these failures is invisible at call time. The tool returns a success response. The agent proceeds confidently on corrupt input.

## Context

This pattern applies to any agentic session that calls tools known to return variable-size output. It is most critical when:

- **The output is a complete enumeration** — "list all files", "list all issues", "get all memory topics" — where missing items produces an incorrect count or a false-negative lookup
- **The agent uses the output for dedup or existence checks** — partial results cause false "not found" conclusions
- **The session handles large codebases or long-lived backlogs** — repositories and issue trackers grow over time; a tool call that was safe at 20 items is unsafe at 200
- **Memory topics grow without bounds** — a memory topic written to repeatedly across many sessions can exceed the default recall preview window

It does NOT apply to:
- **Tools with bounded, known-small output** — fetching a specific small file, calling `get_me`, reading a config with a known schema
- **Exploratory investigation where completeness isn't required** — sampling the first few results is acceptable when the agent only needs representative examples, not an exhaustive list

## Solution

**Before invoking a tool known to return large output, apply an explicit size-limiting strategy. Choose one of the four approaches below based on the tool and the access pattern needed.**

### Strategy 1 — Filter at Source

Pass query parameters to constrain the result set before it reaches the agent. This is the preferred strategy — it reduces both output size and context consumption.

```
# BAD — returns all issues; may silently drop items past the default page
github-list_issues owner=OWNER repo=REPO

# GOOD — narrow the query to only the items relevant to the task
github-search_issues query="is:issue is:open label:status:draft" owner=OWNER repo=REPO perPage=50

# BAD — directory listing returns full metadata for every file (45KB for large repos)
github-get_file_contents owner=OWNER repo=REPO path="src/content/patterns"

# GOOD — filter to recently-modified files matching a specific extension (sampling, not exhaustive)
# For completeness-critical enumeration, use pagination (Strategy 2) after filtering
github-search_code query="repo:OWNER/REPO path:src/content/patterns extension:md" perPage=30
```

**For `grep`:** use the most specific pattern possible; set `head_limit` to a number you're confident covers the expected match count, and verify the actual count isn't suspiciously round (30, 50, 100 — common truncation boundaries).

**For `recall_memory`:** if the topic is known to be large, pass `view_range` to read only the section relevant to the task:

```
# BAD — returns full topic; preview truncated at system limit
recall_memory query="project manifest" include_patches=false

# GOOD — read the specific section (first 80 lines cover most headers)
recall_memory query="project manifest" view_range=[1, 80] include_patches=false
```

### Strategy 2 — Paginate Explicitly

For multi-page resources, iterate pages and accumulate results. Never assume one call returns all items.

```
# Step 1: request first page with an explicit page size
github-list_issues owner=OWNER repo=REPO perPage=100 page=1

# Step 2: check if result count == perPage — if so, there may be more
github-list_issues owner=OWNER repo=REPO perPage=100 page=2

# Repeat until result count < perPage OR a definitive termination signal is found
```

**Pagination termination conditions** — use the most reliable signal available:

1. **`result.length < perPage`** — a strong heuristic (last page is typically smaller), but unreliable when the total happens to be an exact multiple of `perPage`; a page returning exactly `perPage` items could be either mid-stream or the final page.
2. **`total_count` equals accumulated count** — most reliable; available on GitHub **search** endpoints (`github-search_issues`, `github-search_code`) but **not** on list endpoints (`github-list_issues`, `github-list_commits`) which are REST-based and do not return `total_count`. Note: GitHub search returns a maximum of 1,000 results regardless of `total_count`; if `total_count > 1000`, pagination alone cannot exhaust the full result set — narrow the query further.
3. **`pageInfo.hasNextPage: false`** — definitive cursor-based signal when the endpoint exposes it.

**Mutable-resource caveat:** Page-number pagination on mutable REST resources (issues, pull requests, comments) is inherently racy — inserts, updates, or state changes between page requests can cause items to shift pages, producing duplicates or omissions even when all pages are fetched. For completeness-critical tasks on mutable resources, prefer search endpoints with `total_count` + cursor-based pagination where available. When REST list pagination is unavoidable, treat the accumulated result as a best-effort snapshot, not a guaranteed-complete set.

**Do not** rely on "the response looked complete" as a termination signal. A full page of exactly 30 items always looks complete.

### Strategy 3 — Detect Truncation Before Acting

Check for truncation signals in the response before using the output for any decision that requires completeness.

Common truncation signals:

| Tool | Signal | Meaning |
|------|--------|---------|
| `github-list_issues` | `result.length == perPage` | Possible truncation (heuristic — see Strategy 2 notes on exact multiples) |
| `github-search_*` | `total_count > result.length` | Definitive — results were cut; paginate or narrow the query |
| `grep` | Matches count == `head_limit` | Limit reached, more may exist |
| `github-get_file_contents` (directory) | Tool output message starts with "Output too large" | Saved to `/tmp`, not in context |
| `recall_memory` | Output ends mid-sentence or mid-list | Truncated at display limit |
| `view` (file) | "File truncated at 50KB" notice | Only partial file shown |

**Important:** Strategy 3 *detects* truncation — it does not recover the missing data. When a truncation signal is detected, you must also apply Strategy 1 or 2 to retrieve the complete dataset before acting. Detection alone is not sufficient for completeness-sensitive tasks.

When a truncation signal is detected:
1. **Do not act on the partial result as if complete**
2. Switch to a more targeted Strategy 1 query, OR paginate (Strategy 2) to retrieve remaining items
3. If completeness is not required for the task, explicitly note "acting on partial data: first N items only" before proceeding

### Strategy 4 — Targeted Post-Processing Extraction

After a large-output call that cannot be filtered or paginated (e.g., a tool that returns a large JSON blob with no filter parameters), use a secondary extraction step to pull only the needed fields before reasoning over the data.

**Prerequisite:** This strategy applies when the tool saves output to a `/tmp` file and the truncation notice provides the exact path. The path is ephemeral and changes on each call — always read the path from the truncation notice rather than hardcoding it. Strategy 4 is not available in environments where the agent cannot access the tool host's filesystem.

```bash
# After github-get_file_contents on a directory saves output to /tmp/<notice-path>:
# (read the exact path from the tool's "Output too large, saved to:" notice)
node -e "
  const fs = require('fs');
  const files = JSON.parse(fs.readFileSync('/tmp/<notice-path>'));
  console.log(files.map(f => f.name).join('\n'));
"
# Result: just the filenames — 57 lines instead of 45KB of JSON
```

```bash
# After a large grep result, extract only unique file paths:
# Note: cut -d: -f1 may misparse filenames containing colons (rare but possible)
grep -r "pattern" src/ --include="*.ts" -l
# Prefer grep's -l flag (list filenames only) over post-processing with cut
```

This strategy trades a small secondary tool call for a large reduction in context consumed by reasoning over the full blob.

### Decision Matrix

| Question | Recommended Strategy |
|----------|---------------------|
| Can the tool's query parameters constrain the result? | **Strategy 1** (Filter at Source) — always preferred; paginate afterward if completeness is required |
| Is the result a search endpoint with a `total_count`? | **Strategy 2** with `total_count` termination (check for >1000 cap) |
| Is the result a REST list endpoint (no `total_count`)? | **Strategy 2** with empty-page confirmation (best-effort; see mutable-resource caveat) |
| Did the tool return a suspiciously round number of results? | **Strategy 3** (Detect Truncation) — then apply Strategy 1 or 2 to recover the missing data |
| Is the tool output a large blob saved to `/tmp`? | **Strategy 4** (Targeted Extraction) — if filesystem is accessible |
| Does the task require a complete enumeration? | Apply **Strategy 2** (paginate) + **Strategy 3** (verify no truncation signals remain) |
| Does the task only need a representative sample? | **Strategy 1** with a reasonable limit is sufficient; note in output that sampling was used |

## Evidence

**Manifest builder on 57-file repo**: `github-get_file_contents(path="src/content/patterns")` returned a 45.7KB JSON response. The tool saved the full response to `/tmp` and provided only a preview (first ~500 characters — one file entry's metadata) in the agent's context. A follow-up `node` extraction step (Strategy 4) parsed the `/tmp` file and returned 57 filenames in ~30 lines. The manifest was built correctly; acting on the truncated in-context preview would have produced a 1-item manifest.

**`recall_memory` 60KB topic truncation**: A memory topic tracking the project manifest had grown to ~60KB after 15 weeks of incremental updates. `recall_memory(query="project-agent-prompt-patterns-manifest")` returned a truncated preview. The agent passed `view_range=[1, 40]` on the second call to read the header section specifically, then `view_range=[41, 80]` (non-overlapping) for the manifest body — two targeted reads instead of one truncated large one.

**`github-list_issues` false-negative dedup**: An ideation cron called `github-list_issues` without `perPage` to check for existing issues. The repo had 91 open issues; the API returned 30 (one page, default). The target issue was #67 — it was not in the first 30. The cron concluded "not found" and filed a duplicate. Switching to `github-search_issues` (which returns `total_count`) with `perPage=100` covered all 91 issues in one call and the dedup check worked. Note: `perPage=100` happened to cover all 91 issues; a repo with 150+ open issues would require explicit pagination. Also note: GitHub search is eventually consistent — very recently created issues (within seconds) may not yet be indexed; for time-critical dedup of recently filed items, supplement with `github-list_issues perPage=10 page=1` sorted by creation date to catch the newest items. See [Dedup-Search Before Filing](/agent-prompt-patterns/patterns/dedup-search-before-filing) for the issue-filing-specific treatment.

**Round-number truncation signal**: A `grep` call with `head_limit=50` returned exactly 50 matches. The agent recognized 50 as a common truncation boundary and re-ran with `head_limit=200`. The actual match count was 73. Acting on the 50-item result would have missed 23 matches (31% of the real result set).

## Tradeoffs

**Benefit**: Prevents silent data loss from tool truncation. The fix cost is 1–2 additional targeted tool calls or a parameter adjustment. The cost of acting on truncated data ranges from a minor inaccuracy to a completely wrong conclusion (false-negative dedup, incomplete manifest, missed file).

**Cost**: Requires up-front knowledge of which tools return variable-size output. Paginated enumeration adds latency proportional to result set size.

**Watch out for**:

- **The "output looks complete" trap**: Truncated tool output does not announce itself. A response ending mid-sentence is a clear signal; a response ending at exactly 30 items is not — it looks like a clean, complete result. Treat round result counts as truncation suspects, not as confirmation of completeness.

- **`/tmp` file saves as invisible output**: When tools save large output to `/tmp` due to size limits, the in-context response may show only a preview. Always check for "Output too large, saved to `/tmp/...`" notices. If present, read the file — the context preview is not usable for completeness-sensitive tasks.

- **Recall memory topic growth**: Memory topics written to repeatedly across sessions grow without automatic pruning. A topic that was 5KB six months ago may be 60KB today. Pass `view_range` proactively for any topic known to be a long-running accumulation log.

- **`perPage` maximums and endpoint behavior**: GitHub's API allows `perPage=100` for most list and search endpoints; behavior for values above the maximum varies by endpoint — some return HTTP 422 (Unprocessable Entity), others silently clamp to the maximum. Always stay within the documented limit for the specific endpoint.

- **`result.length < perPage` is a heuristic, not a guarantee**: If the total result count happens to be an exact multiple of `perPage`, the last page returns exactly `perPage` items — indistinguishable from a mid-stream page. For completeness-critical tasks, confirm termination by fetching one more page and verifying it is empty, or use a search endpoint that returns `total_count`.

- **GitHub search 1,000-result cap**: GitHub's search API returns at most 1,000 results regardless of `total_count`. If `total_count > 1000`, pagination cannot retrieve the full dataset — narrow the query before paginating (e.g., add date ranges, label filters, or state filters).

- **GitHub search is eventually consistent**: Newly created issues and commits may not appear in search results immediately. For dedup checks on very recently filed issues (within seconds), supplement search with `github-list_issues page=1 perPage=10` sorted by creation date to catch items not yet indexed.

- **`filename:` search qualifier does not accept globs**: GitHub's `github-search_code filename:` qualifier matches exact filenames, not glob patterns. Use `path:` to restrict to a directory and `extension:` to filter by file type. Always include `repo:OWNER/REPO` to scope the search to the intended repository.

- **Strategy 1 filtering is not the same as complete enumeration**: Filtering reduces result size but does not guarantee exhaustive coverage when the filter matches more items than `perPage`. A filtered search that returns exactly `perPage` items may still be truncated. For complete enumeration, combine filtering (Strategy 1) with pagination (Strategy 2) and truncation detection (Strategy 3).

- **Pagination is not free**: For very large result sets (hundreds of items), full pagination is expensive in both API calls and context. Use Strategy 1 (filter at source) to reduce the result set before paginating — paginate a narrow query, not a broad one.

- **Strategy 4 requires filesystem access**: Strategy 4 (Targeted Extraction from `/tmp`) requires that the agent's execution environment can read files at the path reported in the truncation notice. In cloud-hosted or sandboxed agent environments where tool output is delivered through a different channel, the `/tmp` path may be unreachable. Confirm the execution model before relying on this strategy.

## Related Patterns

- **[Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)** — the session-level budget discipline; Large Tool Output Guard is the per-call enforcement mechanism that prevents individual tool calls from overconsuming the budget
- **[Enumeration-First Verification](/agent-prompt-patterns/patterns/enumeration-first-verification)** — explicitly enumerates the full item set before making claims about it; depends on Large Tool Output Guard ensuring the enumeration is actually complete
- **[Parallel Tool Call Batching](/agent-prompt-patterns/patterns/parallel-tool-call-batching)** — batches independent tool calls in one turn; pairs well with Strategy 1 filtering (make multiple narrow parallel calls rather than one wide serial call)
- **[Dedup-Search Before Filing](/agent-prompt-patterns/patterns/dedup-search-before-filing)** — applies Large Tool Output Guard in the specific context of issue dedup searches; "not found" conclusions require complete results to be valid
