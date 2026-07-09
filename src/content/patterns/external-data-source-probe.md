---
title: "External Data Source Probe"
category: "task-design"
evidenceLevel: "moderate"
summary: "Before filing or implementing a feature that depends on external data (government open-data APIs, scraped datasets, CSV column fields), an agent probes the actual source to verify existence, format, and field availability. Sprints that skip this step hit a data-availability wall mid-implementation, producing either a failed sprint or a misleading 'data probably available' stub."
relatedPatterns: ["empirical-gate-before-persisting-diagnosis", "schema-validation-before-processing", "hypothesis-before-action", "capability-preflight-gate"]
tags: ["data", "external-data", "preflight", "feasibility", "gov-open-data", "csv", "api", "sprint-gating", "task-design"]
---

## Problem

An agent is filing or implementing a feature that requires external data — a government open-data endpoint, a specific CSV column in a bulk-download file, a scraped dataset, or a third-party API response field. The issue body says something like:

> "We can probably get this from the 公告現值 field in the PLVR CSV."

The sprint starts. Midway through, it discovers that the field does not exist, the endpoint returns an unexpected schema, the column layout shifted in a recent format update, or the API requires authentication that was not provisioned. The sprint fails or lands a misleading stub that silently produces empty output.

**The root cause is not the implementation** — it is the missing feasibility check at issue-filing time. The issue was treated as `status:draft` (ready to sprint) when it should have been `status:needs-input` (blocked on external verification).

This failure is common with:

- **Government open-data CSVs** whose column layouts shift without notice (e.g., a 28-column format that added 2 extra fields mid-row, breaking downstream parsers)
- **External APIs** that require key registration, specific query parameters, or return paginated results in an undocumented format
- **Dataset join features** that assume a shared key field exists in both datasets without verifying its presence, cardinality, or encoding

The cost is compounded in agentic systems: a sprint that stalls mid-flight due to missing data costs more than a sprint that was never dispatched — it may leave behind partial implementation stubs, misleading issue comments, or open PRs in an indeterminate state.

## Context

This pattern applies at the **issue-filing** and **sprint-dispatch** checkpoints — specifically when:

- An issue references external data by name without a verification note
- A sprint is about to be dispatched for a feature whose data dependency has not been confirmed
- An ideation agent is converting a data-dependent idea into a `status:draft` issue

It is most critical for:

- **Government open-data pipelines** (Taiwan PLVR bulk-download CSVs, subsidy datasets, geocoding APIs) where schemas shift without versioning
- **Web-scraped data** where endpoint availability and field structure depend on third-party site changes
- **Dataset joins** where a feature assumes a shared ID or key column exists in both data sources
- **Features that depend on a specific API response field** that the agent has not yet received in a real response

The pattern is distinct from `schema-validation-before-processing` (which validates data at runtime during processing) and `hypothesis-before-action` (which gates actions on untested hypotheses). This pattern gates **issue status assignment**: a data-dependent issue should not be `status:draft` until the data dependency is verified.

## Solution

### The Four-Step Probe Protocol

When an issue or feature depends on external data, apply this protocol before setting `status:draft`:

**Step 1: Identify the data dependency**

Name the specific endpoint, dataset, file, or column the feature requires. Be precise:

```
NOT: "uses PLVR data"
YES: "requires field `公告現值` (announced land value) in column 14 of `a_lvr_land_a.csv`
     from https://plvr.land.moi.gov.tw/DownloadOpenData"
```

**Step 2: Probe it**

Run a minimal check to confirm the data is accessible and contains the expected field. The probe does not need to be production-grade — it needs to answer three questions:

1. Is the endpoint accessible (no auth error, no 404)?
2. Does the response contain the expected field / column name?
3. Is the schema at least structurally consistent with what the feature requires?

```bash
# --- Probe a JSON API endpoint ---
# -f exits non-zero on 4xx/5xx so the || branch fires on auth/404 failures
curl -sf "https://api.example.gov/v1/data?limit=1" | jq '.results[0] | keys' \
  || echo "PROBE FAILED: check endpoint availability and auth"

# --- Download a zip bundle and inspect the CSV header ---
# --suffix keeps the .zip extension for unzip; mktemp keeps the path unique
set -o pipefail   # so unzip failures propagate through the pipe
PROBE_TMP=$(mktemp --suffix=.zip /tmp/plvr_probe_XXXXXX)
curl -sf "https://plvr.land.moi.gov.tw/DownloadOpenData?type=zip&fileName=lvr_landcsv.zip" \
  -o "$PROBE_TMP" \
  && unzip -p "$PROBE_TMP" a_lvr_land_a.csv \
     | head -1 \
     | iconv -f big5 -t utf-8 2>/dev/null \        # PLVR CSVs are often Big5-encoded
     | tr ',' '\n' | nl \
  || echo "PROBE FAILED: download, extraction, or encoding error"
rm -f "$PROBE_TMP"

# --- Check that a specific column name is present in the header ---
# PLVR bulk CSVs are frequently Big5/CP950; iconv before grep avoids silent no-match
# on a UTF-8 literal pattern. Use exact matching (full field) to avoid false substring hits.
DATA_URL="https://example.gov/open/data.csv"   # replace with actual URL
curl -sf "$DATA_URL" \
  | head -1 \
  | iconv -f big5 -t utf-8 2>/dev/null \
  | tr ',' '\n' \
  | grep -Fx "公告現值" \
  || echo "PROBE FAILED: field not found or encoding/endpoint issue"

# --- Count columns to detect schema drift ---
# split(',') is not CSV-safe; for a real column count use an actual CSV parser.
# As a quick indicator (no quoted-comma fields in PLVR headers), tr-based count works:
curl -sf "$DATA_URL" | head -1 | iconv -f big5 -t utf-8 2>/dev/null \
  | awk -F',' '{print NR": "NF" columns"}'
# If the source may contain quoted commas, use: python3 -c "import csv,sys; r=csv.reader(sys.stdin); print(len(next(r)),'columns')"
```

> **Encoding note**: Taiwan PLVR bulk CSVs are frequently Big5/CP950-encoded. A UTF-8 `grep` pattern silently fails to match a Big5 column name even when the field exists. Always apply `iconv -f big5 -t utf-8` (or the equivalent NFKC normalization step) before any string comparison. See [Encoding-Aware Probing](#encoding-aware-probing-for-zh-tw-gov-data) below.

**Step 3: Record findings in the issue body**

Add a verification note to the issue before dispatching the sprint:

```
✅ Data verified: field `公告現值` present in `a_lvr_land_a.csv` col 14
   (checked 2026-07-09, PLVR bulk download, 28-col format)

❓ Data unverified: `completion_wave` field does not appear in any available PLVR table.
   Possible sources: construction completion registry (需查詢建管系統), not in current download.
   → Blocking on source identification before sprint dispatch.
```

**Step 4: Gate sprint status accordingly**

| Probe outcome | Issue status |
|---|---|
| All required fields verified, accessible, non-null in representative rows | `status:draft` (ready to sprint) |
| Field exists but encoding unclear (full-width digits, ROC dates) | `status:needs-design` (normalize strategy before sprint) |
| Field present but contains unexpected nulls or only in recent rows | `status:needs-design` (null-handling strategy before sprint) |
| Field not found, source uncertain | `status:needs-input` (human decision required) |
| Endpoint requires auth not yet provisioned | `status:blocked` (unblock first) |

> **Null coverage**: the probe examples above check header presence only. Before assigning `status:draft`, extend the probe to sample a representative row slice (e.g., `head -50` plus a few rows from the oldest available period) and verify the field is non-null across that slice. A field present in the header but null in 95% of historical rows is effectively absent for most use cases.

### Handling Probe Failures Gracefully

A probe failure is not a dead end — it is information:

- **Field not found in expected file**: check whether the field appears in a different table or bulk-download file for the same dataset
- **API returns 401/403**: document the auth requirement in the issue; set `status:blocked` on the auth provisioning sub-task
- **Column count mismatch**: the format may have shifted; download the schema docs (if available) or cross-reference with the most recent format changelog
- **Empty response**: distinguish "no data for this query" from "endpoint deprecated or moved"

The probe result — even a negative one — belongs in the issue body so that the next agent (or human) picking up the issue has the groundwork done.

### Encoding-Aware Probing for zh-TW Gov Data

Taiwan government datasets use full-width digits and CJK characters in column names and field values. When probing these sources:

```bash
# Normalize full-width digits before column search
python3 -c "
import unicodedata, sys
line = sys.stdin.readline()
print(unicodedata.normalize('NFKC', line))
" < header_row.csv | grep "公告現值"

# Check for full-width digit values in a field
head -5 data.csv | python3 -c "
import sys, unicodedata
for line in sys.stdin:
    print(unicodedata.normalize('NFKC', line).strip())
"
```

Column names in PLVR CSVs are often in Traditional Chinese with no English equivalent. The probe must match the exact Unicode-normalized form of the column name — a grep for the half-width equivalent will miss a full-width column header.

## Anti-patterns

**The optimistic stub**: The issue says "data probably available from gov open data." The sprint creates a data-loading module with a placeholder `TODO: verify field name` comment and marks itself complete. CI passes. The stub lands in main. The field is never verified. The feature is never actually functional.

**The cascade assumption**: Feature A assumes data source X exists. Feature B assumes feature A works. Feature C assumes feature B works. None of the three issues contained a probe note. The entire cascade fails when feature A's data source turns out to use a different schema than assumed — but the failure is only discovered when feature C's sprint runs.

**The "checked the docs" shortcut**: The agent reads the API documentation and notes that the field is listed there. Documentation and reality diverge — especially for government APIs that update their data formats without updating their documentation. A probe against the live endpoint is the ground truth; documentation is secondary.

**The single-row sample trap**: The agent downloads one row of the CSV and finds the expected field. But the feature requires all historical records, and only recent records contain that field (older rows have `null` or use a different column position). A probe that checks one row is better than no probe, but a robust probe checks for field presence across the expected date range and verifies that nulls are acceptable.

## Evidence

**realestate-radar #72** — `公告現值` field uncertainty: an agent filed a data-join feature without verifying that the field existed in the PLVR CSV. The issue was dispatched as `status:draft`, the sprint started, and the field was not found in the expected column. The issue was retroactively labeled `needs-design`. Had the probe been run at filing time, the sprint would not have been dispatched and the `needs-design` label would have been the first response, not a correction.

**realestate-radar #43** — timing-intelligence epic, features #3 and #4: two features in the epic were explicitly blocked as `needs-design` because external data sources for completion-wave detection and distress-sale detection were unverified. This is the **correct application of the pattern**: the epic author identified the data dependency, acknowledged it was unverified, and set the correct status. The pattern codifies this discipline so it is applied consistently rather than case-by-case.

**realestate-radar #106** — CSV column layout shift: a government CSV added 2 extra fields mid-row without notice, causing a 28-column parser to misalign all subsequent columns. A probe that checks `NF` (column count) against the expected number would have caught this the moment the format changed, rather than discovering it through broken downstream output. This case also illustrates that probe notes in issue bodies have a shelf life: a verified data source at filing time can become unverified if the probe is not periodically re-run for long-lived features.

## Related Patterns

- **Empirical Gate Before Persisting a Causal Diagnosis** — applies the same empirical discipline to causal claims about agent behavior. Both patterns share the structure: name the claim, run a check, gate on the result. This pattern applies that discipline to *data-source claims* at issue-filing time.
- **Schema Validation Before Processing** — runtime validation of data shape during processing. Complementary: this pattern prevents sprinting into a data wall; schema validation catches mismatches at processing time even for verified sources.
- **Hypothesis Before Action** — gates agent actions on tested hypotheses. This pattern is a specialization for the data-dependency hypothesis ("this data exists in this source").
- **Capability Preflight Gate** — verifies that required tools, credentials, and environment capabilities are present before starting a sprint. External data source probing is a data-capability variant of the same preflight discipline.
