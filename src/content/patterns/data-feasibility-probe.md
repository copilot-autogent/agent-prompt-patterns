---
title: "Data Feasibility Probe"
category: "task-design"
evidenceLevel: "strong"
summary: "Before filing a feature issue that depends on external data (government APIs, scraped datasets, third-party services), an agent runs a minimal feasibility probe to verify the data source is accessible and contains the expected fields. Issues filed without a probe frequently stall mid-sprint when the required data turns out to be missing, auth-gated, or structurally different from what was assumed. Probe first; gate sprint dispatch on the result."
relatedPatterns: ["external-data-source-probe", "capability-preflight-gate", "hypothesis-before-action", "schema-validation-before-processing", "dedup-search-before-filing"]
tags: ["data-integrity", "issue-triage", "external-dependencies", "autonomous-agents", "sprint-efficiency", "preflight", "feasibility", "gov-open-data", "task-design"]
---

## Problem

An agent drafts a feature issue that depends on an external data source — a government open-data API, a bulk-download CSV, a scraped webpage, or a third-party service endpoint. The issue is filed as `status:draft` and dispatched to a sprint. The sprint discovers mid-implementation that:

- The required API field does not exist in the live response
- The CSV column was renamed or removed in a format update
- The endpoint requires authentication that was never provisioned
- The data exists but is encoded in a way that makes the field inaccessible without normalization

The sprint stalls, fails, or ships a misleading stub. The issue is retroactively labeled `needs-design` or `needs-input`.

**Three failure modes in agentic systems:**

**1. Wasted sprint effort.** A four-hour sprint discovers the data wall at hour two, after branch creation, partial implementation, and open PR. The half-built state is harder to clean up than if the sprint had never started. The wasted sprint time often exceeds the time that would have been spent on a two-minute probe at filing time.

**2. Shipped-but-broken features.** CI passes because the data-loading module compiles and the stub returns an empty array. The feature merges green, deploys, and silently produces zero output in production. The failure is only discovered when a user notices the empty chart or zero-record table.

**3. Indefinite `needs-design` dwell.** The issue is correctly blocked at dispatch time, but the probe was never run, so the `needs-design` state is unresolvable without someone manually verifying data availability. Issues sit for days waiting for a human to answer a question an agent could have answered in seconds.

**What these failures have in common:** the issue was treated as `status:draft` (ready to sprint) when it should have been `status:needs-input` (blocked on external verification). The gap is a missing feasibility probe at issue-filing time.

## Context

This pattern applies at the **issue-filing** checkpoint — specifically when an issue body contains any of these signals:

- References to an API endpoint, CSV column, dataset field, or scraped content by name
- Language like "probably available from", "should be in", "we can get this from", or "check if available"
- Features described as dependent on a data join (two sources share a field)
- Features that assume a specific data format (column positions, encoding, schema version)

The pattern is most critical for:

- **Government open-data pipelines** (Taiwan PLVR CSVs, subsidy datasets, geocoding APIs) whose schemas shift without versioning
- **Dataset join features** where a field is assumed to exist in both sources without verification
- **Third-party API features** where the specific response field hasn't been seen in a live response
- **Web-scraped data** where site structure can change between filing time and sprint time

This pattern operates at the **process level** (when to probe, how to gate sprint dispatch, how to record results). For the technical details of how to run specific probe types (bash commands, encoding-aware CSV probing, API HEAD requests), see `external-data-source-probe`.

## Solution

### Step 1: Identify the Dependency Precisely

When drafting a feature issue, explicitly list all external data dependencies in the issue body. Vague references block sprint progress; precise references enable targeted probes.

```
NOT: "uses PLVR data to show land value trends"

YES: "requires field `公告現值` (announced land value)
     in column 14 of `a_lvr_land_a.csv`
     from https://plvr.land.moi.gov.tw/DownloadOpenData?type=zip&fileName=lvr_landcsv.zip"
```

For each dependency, capture:
- **Source URL** — exact endpoint or download URL
- **Expected field** — exact column name, JSON key, or DOM selector
- **Auth requirements** — whether the source requires API key, token, or login
- **Update frequency** — how often the source changes (daily, quarterly, ad-hoc)

### Step 2: Run a Probe

A probe answers three questions:
1. Is the endpoint accessible (no auth block, no 404, no redirect to login)?
2. Does the response contain the expected field or column?
3. Is the schema structurally consistent with what the feature requires?

The probe does not need to be comprehensive — a single `curl` and a field check is often sufficient. See `external-data-source-probe` for specific probe scripts for JSON APIs, CSV bulk-downloads, and scraped content.

**Probe reliability notes:**
- **Check HTTP status first**: a `curl`/`grep` on a string can false-positive against login pages, HTML error bodies, or error envelopes that mention the field name. Confirm the response is HTTP 2xx with the expected Content-Type before treating a string match as proof of presence.
- **Dataset joins require join-key compatibility**: verifying that both sources contain the expected fields is necessary but not sufficient. Check that the join key has compatible normalization (same encoding, same ID format, same cardinality range) in both datasets. Two sources can each contain a field while being unusable for a join due to key mismatch.
- **Prefer header-name verification over column position**: record the field's column name as it appears in the header row, not its absolute position. Column positions shift when format updates add or remove fields; the name is the stable identifier.

> **Probe confidence floor**: check at least one representative data row, not just the header. A field present in the header but null in 95% of rows is effectively absent for most features.

### Step 3: Record the Probe Result in the Issue Body

Add a `## Data Feasibility` section to every issue with an external data dependency:

```markdown
## Data Feasibility

✅ `公告現值` — verified present in `a_lvr_land_a.csv` by header name (column 14 in current format)
   (checked 2026-07-09; non-null in sampled 50 rows; HTTP 200 application/zip)

❌ `completion_wave` — not found in PLVR bulk download or cadastral data
   Possible alternative: construction completion registry (需查詢建管系統)
   → Blocking sprint dispatch pending source identification
```

**Credential hygiene**: probe results recorded in issue bodies must not include API tokens, signed URLs, session cookies, or any credential material. Record only the probe outcome (field present/absent, endpoint status code, column name) — not the command with embedded auth headers or the raw response body if it contains private data.

This note serves two functions:
- It communicates the verification status to the sprint agent so it doesn't re-probe from scratch
- It records the probe timestamp, enabling staleness detection for long-lived issues (a probe done six months ago may be stale for a frequently-updated source)

### Step 4: Gate Sprint Dispatch on the Result

| Probe outcome | Correct issue status |
|---|---|
| All required fields verified, accessible, non-null in representative rows | `status:draft` — ready to sprint |
| Field exists but encoding or format requires clarification | `status:needs-design` — resolve strategy before sprinting |
| Field present but significant null rate in historical data | `status:needs-design` — define null-handling strategy |
| Join-key compatibility unverified (encoding/cardinality mismatch possible) | `status:needs-design` — verify join feasibility before sprinting |
| Rate limit, licensing, robots.txt, or TOS constraint unresolved | `status:needs-design` — verify operational constraints before sprinting |
| Field not found; alternate source unknown | `status:needs-input` — human decision required on source |
| Endpoint requires auth not yet provisioned | `status:blocked` — unblock auth first |

**Default when in doubt**: if the probe cannot be completed (endpoint unreachable from the current environment, data download too large to sample quickly), set `status:needs-design` with a note explaining why the probe was inconclusive. Do not set `status:draft` when the data dependency is unverified.

### Integration Into the Issue-Filing Workflow

For an autonomous ideation agent, this becomes a pre-condition on `status:draft` assignment:

```
Issue draft assembled
          │
          ├─ Contains external data reference?   NO  ──► Set status:draft (no probe needed)
          │
          └─ YES
               │
               ├─ Run probe(s) for each dependency
               │
               ├─ All probes passed?             YES ──► Set status:draft
               │
               ├─ Any probe inconclusive?        YES ──► Set status:needs-design
               │
               └─ Any probe failed?              YES ──► Set status:needs-input or status:blocked
```

## Evidence

**subsidy-radar (60% frequency, 5 projects)**: Data-availability issues were the most common `needs-design` trigger across subsidy-radar, realestate-radar, shogi-srs, and two other projects tracked between Q1–Q2 2026. In approximately 60% of `needs-design` transitions where the reason was identified, the blocking question was "does this specific data field actually exist in this source?" — a question a two-minute probe would have answered at filing time.

**realestate-radar #43 (pattern correct application)**: Two features in the timing-intelligence epic were explicitly blocked as `status:needs-design` because external data sources for completion-wave detection and distress-sale detection were unverified. The issue author recognized the unverified dependency and set the correct status upfront. Sprint dispatch was not attempted. This is the reference example of the pattern applied correctly.

**realestate-radar #72 (pattern missing)**: A data-join feature was filed as `status:draft` without verifying that `公告現值` existed in the expected CSV column. The sprint was dispatched, ran, and could not find the field. The issue was retroactively labeled `needs-design`. The sprint time was wasted; the probe would have taken under two minutes.

**realestate-radar #106 (format shift detection)**: A government CSV added two extra fields mid-row without notice, breaking a 28-column parser. A probe that checked column count against the expected number AND matched fields by header name (not position) would have caught the format shift the moment the file was regenerated. Instead, the mismatch was discovered through broken downstream output after sprint completion.

**Pattern cross-reference**: The same probe discipline appears in `external-data-source-probe` (technical probe execution), `hypothesis-before-action` (gating actions on untested hypotheses), and `capability-preflight-gate` (verifying required resources before sprint start). This pattern operationalizes the discipline specifically at the issue-filing step, where the cost of catching the problem is lowest.

## Success Metrics

Teams applying this pattern can track:

- **`needs-design` dwell time for data-availability issues**: median time from `needs-design` → `status:draft` should decrease when the agent probes upfront (agent resolves the question rather than waiting for human verification). Target: median ≤1 day vs. 2–3 days for unprobed issues.
- **Mid-sprint data-wall failure rate**: fraction of sprints that fail or stall due to missing/inaccessible data. Target: near zero for dispatched issues with a `Data Feasibility ✅` note.
- **Production 404s from data-source failures**: features that ship with CI green but produce empty/broken output due to a data source being unreachable or schema-mismatched. These should be caught by the probe gate, not production.

## Anti-patterns

**The optimistic stub**: Issue says "data probably available." Sprint creates a data-loading module with `TODO: verify field name` and marks itself complete. CI passes. The unresolved TODO lands in main. The feature never works.

**"I checked the docs"**: The agent reads the API documentation and notes the field is described there. Documentation and reality diverge, especially for government APIs. A probe against the live endpoint is the ground truth; documentation is a starting point.

**Probe once, trust forever**: A feasibility note added six months ago may be stale — sources change, column layouts shift, APIs move. Issues with a `Data Feasibility ✅` note older than 90 days should be re-probed before sprint dispatch for frequently-updated sources (quarterly or more frequent data refreshes).

**Single-row sampling**: Checking one row of a CSV confirms the column exists in the header; it does not confirm non-null values in historical data. Always sample a representative slice (at minimum the header + 50 rows from the target time range) before setting `status:draft`.
