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

# GOOD — search for specific files matching a naming pattern
github-search_code query="filename:*.md path:src/content/patterns" perPage=30
```

**For `grep`:** use the most specific pattern possible; set `head_limit` to a number you're confident covers the expected match count, and verify the actual count isn't suspiciously round (30, 50, 100 — common truncation boundaries).

**For `recall_memory`:** if the topic is known to be large, pass `view_range` to read only the section relevant to the task:

```
# BAD — returns full topic; preview truncated at system limit
recall_memory(query="project manifest", include_patches=false)

# GOOD — read the specific section (first 80 lines are always the header)
recall_memory(query="project manifest", view_range=[1, 80], include_patches=false)
```

### Strategy 2 — Paginate Explicitly

For multi-page resources, iterate pages and accumulate results. Never assume one call returns all items.

```
# Step 1: request first page with an explicit page size
github-list_issues owner=OWNER repo=REPO perPage=100 page=1

# Step 2: inspect the response total_count (or check if result count < perPage)
# If result count == perPage, there may be more — fetch page 2
github-list_issues owner=OWNER repo=REPO perPage=100 page=2

# Repeat until result count < perPage (signals last page)
```

**Pagination termination condition:** stop when:
- `result.length < perPage` (last page, fewer items than requested)
- The tool exposes a `total_count` and accumulated items equals it
- The tool returns a `pageInfo.hasNextPage: false` cursor signal

**Do not** rely on "the response looked complete" as a termination signal. A full page of exactly 30 items always looks complete.

### Strategy 3 — Detect Truncation Before Acting

Check for truncation signals in the response before using the output for any decision that requires completeness.

Common truncation signals:

| Tool | Signal | Meaning |
|------|--------|---------|
| `github-list_issues` | `result.length == perPage` | May be more pages |
| `github-search_*` | `total_count > result.length` | Results were cut |
| `grep` | Matches count == `head_limit` | Limit reached, more may exist |
| `github-get_file_contents` (directory) | Tool output message starts with "Output too large" | Saved to `/tmp`, not in context |
| `recall_memory` | Output ends mid-sentence or mid-list | Truncated at display limit |
| `view` (file) | "File truncated at 50KB" notice | Only partial file shown |

When a truncation signal is detected:
1. **Do not act on the partial result as if complete**
2. Switch to a more targeted Strategy 1 query, OR paginate to retrieve remaining items
3. If completeness is not required for the task, explicitly note "acting on partial data: first N items only" before proceeding

### Strategy 4 — Targeted Post-Processing Extraction

After a large-output call that cannot be filtered or paginated (e.g., a tool that returns a large JSON blob with no filter parameters), use a secondary extraction step to pull only the needed fields before reasoning over the data.

```bash
# After github-get_file_contents on a directory saves 45KB to /tmp/output.txt:
node -e "
  const fs = require('fs');
  const files = JSON.parse(fs.readFileSync('/tmp/output.txt'));
  console.log(files.map(f => f.name).join('\n'));
"
# Result: just the filenames — 57 lines instead of 45KB of JSON
```

```bash
# After a large grep result:
grep -r "pattern" src/ | cut -d: -f1 | sort -u
# Result: just the unique file paths, not full match context
```

This strategy trades a small secondary tool call for a large reduction in context consumed by reasoning over the full blob.

### Decision Matrix

| Question | Recommended Strategy |
|----------|---------------------|
| Can the tool's query parameters constrain the result? | **Strategy 1** (Filter at Source) — always preferred |
| Is the result a paginated resource with a known `total_count`? | **Strategy 2** (Paginate Explicitly) |
| Did the tool return a suspiciously round number of results? | **Strategy 3** (Detect Truncation) — suspect truncation |
| Is the tool output a large blob with no filter API? | **Strategy 4** (Targeted Extraction) |
| Does the task require a complete enumeration? | Apply **Strategy 2** or **3**; sampling is not acceptable |
| Does the task only need a representative sample? | **Strategy 1** with a reasonable limit is sufficient |

## Evidence

**Manifest builder on 57-file repo**: `github-get_file_contents(path="src/content/patterns")` returned a 45.7KB JSON response that was saved to `/tmp` by the tool. The agent's context received only the first 500 characters — a single file's metadata. A follow-up `node` extraction step (Strategy 4) parsed the `/tmp` file and returned 57 filenames in ~30 lines. The manifest was built correctly; acting on the truncated in-context response would have produced a 1-item manifest.

**`recall_memory` 60KB topic truncation**: A memory topic tracking the project manifest had grown to ~60KB after 15 weeks of incremental updates. `recall_memory(query="project-agent-prompt-patterns-manifest")` returned a truncated preview. The agent passed `view_range=[1, 40]` on the second call to read the header section specifically, then `view_range=[40, 80]` for the manifest body — two targeted calls instead of one unread large one.

**`github-list_issues` false-negative dedup**: An ideation cron called `github-list_issues` without `perPage` to check for existing issues. The repo had 91 open issues; the API returned 30 (one page). The target issue was #67 — it was not in the first 30. The cron concluded "not found" and filed a duplicate. Adding `perPage=100` to the call returned all 91 issues on one page, and the dedup check worked. (See [Dedup-Search Before Filing](/agent-prompt-patterns/patterns/dedup-search-before-filing) for the issue-filing-specific version of this problem.)

**Round-number truncation signal**: A `grep` call with `head_limit=50` returned exactly 50 matches. The agent checked whether 50 was a common truncation boundary (it is) and re-ran the grep with `head_limit=200`. The actual match count was 73. Acting on the 50-item result would have missed 23 matches (31% of the real result set).

## Tradeoffs

**Benefit**: Prevents silent data loss from tool truncation. The fix cost is 1–2 additional targeted tool calls or a parameter adjustment. The cost of acting on truncated data ranges from a minor inaccuracy to a completely wrong conclusion (false-negative dedup, incomplete manifest, missed file).

**Cost**: Requires up-front knowledge of which tools return variable-size output. Paginated enumeration adds latency proportional to result set size.

**Watch out for**:

- **The "output looks complete" trap**: Truncated tool output does not announce itself. A response ending mid-sentence is a clear signal; a response ending at exactly 30 items is not — it looks like a clean, complete result. Treat round result counts as truncation suspects, not as confirmation of completeness.

- **`/tmp` file saves as invisible output**: When tools save large output to `/tmp` due to size limits, the in-context response may show only a preview. Always check for "Output too large, saved to `/tmp/...`" notices. If present, read the file — the context preview is not usable for completeness-sensitive tasks.

- **Recall memory topic growth**: Memory topics written to repeatedly across sessions grow without automatic pruning. A topic that was 5KB six months ago may be 60KB today. Pass `view_range` proactively for any topic known to be a long-running accumulation log.

- **`perPage` maximums vary by endpoint**: GitHub's API allows `perPage=100` for most list endpoints. Requesting `perPage=200` silently clamps to 100 — you will still get exactly 100 items and may miss items 101+. Know the endpoint maximum before assuming one call covers everything.

- **Pagination is not free**: For very large result sets (hundreds of items), full pagination is expensive in both API calls and context. Use Strategy 1 (filter at source) to reduce the result set before paginating — paginate a narrow query, not a broad one.

- **Extraction scripts require the `/tmp` file to exist**: Strategy 4 assumes the tool saved output to a known `/tmp` path. Verify the path from the truncation notice before running the extraction script. Paths include a timestamp and random suffix and change each call.

## Related Patterns

- **[Context Window Budgeting](/agent-prompt-patterns/patterns/context-window-budgeting)** — the session-level budget discipline; Large Tool Output Guard is the per-call enforcement mechanism that prevents individual tool calls from overconsuming the budget
- **[Enumeration-First Verification](/agent-prompt-patterns/patterns/enumeration-first-verification)** — explicitly enumerates the full item set before making claims about it; depends on Large Tool Output Guard ensuring the enumeration is actually complete
- **[Parallel Tool Call Batching](/agent-prompt-patterns/patterns/parallel-tool-call-batching)** — batches independent tool calls in one turn; pairs well with Strategy 1 filtering (make multiple narrow parallel calls rather than one wide serial call)
- **[Dedup-Search Before Filing](/agent-prompt-patterns/patterns/dedup-search-before-filing)** — applies Large Tool Output Guard in the specific context of issue dedup searches; "not found" conclusions require complete results to be valid
