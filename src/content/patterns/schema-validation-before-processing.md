---
title: "Schema Validation Before Processing"
category: "task-design"
evidenceLevel: "promising"
summary: "Agents pass external data directly to business logic, assuming its structure matches what was true at development time. Schema drift — new columns inserted, required keys removed, types changed — causes silent data corruption or cryptic downstream errors. Validate the structure of any external data source explicitly, fail loudly on mismatch, and normalize encoding before validation."
relatedPatterns: ["input-trust-classification", "empirical-validation-loop", "large-tool-output-guard"]
tags: ["data-pipeline", "validation", "schema", "defensive", "external-data", "encoding", "error-handling"]
---

## Problem

Agents that process external data — API responses, CSV exports, government open-data files, JSON payloads — commonly assume that the data structure matches the expected layout at call time. This assumption works until it doesn't: a data provider inserts two extra columns mid-row, removes a previously-required field, changes a numeric field to a string, or switches character encodings.

When schema drift occurs without upfront validation, three failure modes compound:

**Silent data corruption**: If column positions shift in tabular data, positional indexing (`row[5]`) silently reads the wrong field. The agent processes the data without error, producing incorrect output that propagates downstream before anyone notices. By the time the bug surfaces in a consumer or report, tracing back to the schema shift requires forensic investigation.

**Cryptic runtime errors**: Without a schema boundary, type mismatches surface as null pointer exceptions, regex mismatches, or parse failures deep in processing code — far from the data ingestion point. The error message references the symptom, not the cause. A validation error at ingestion would be immediately actionable; a crash in the fourth transformation stage is not.

**Encoding traps**: Data sources from locales that use multi-byte character sets (e.g., full-width CJK digits in East Asian government datasets) produce field values that look like numbers but don't match narrow character class patterns (`\d`, `[0-9]`). Running type checks or regex parsing on unormalized encoding produces false validation failures or silent mismatches that are indistinguishable from genuine schema errors.

## Context

This pattern applies to any agent that ingests data from sources it does not control: third-party APIs, government open-data portals, uploaded files, database exports, or any pipeline that crosses an organizational boundary.

It is most critical when:

- **Column-indexed tabular data** is consumed (CSV, TSV, spreadsheet exports) — positional indexing is fragile to any column insertion or removal.
- **Recurring ingestion pipelines** re-fetch the same source on a schedule — the schema that was valid last week may not be valid today.
- **Data crosses locale or encoding boundaries** — sources using full-width characters, BOM-prefixed files, or mixed encodings require normalization before any structural check.
- **Downstream consumers depend on field presence and type** — a missing field that defaults to `null` without notice can cascade into incorrect computations or silent omissions.

The pattern is less critical for data the agent generates itself (e.g., writing a JSON file and immediately reading it back) or for fixed, well-tested internal API contracts with strong versioning guarantees.

## Solution

Apply schema validation as a mandatory gate between data ingestion and business logic. Structure the validation as four explicit steps:

**Step 1 — Enumerate expected structure before writing processing code.** Document the schema as a first-class artifact: field names, column order (for tabular data), required vs. optional fields, data types, value constraints, and encoding expectations. This forces the schema assumption to be explicit rather than implicit in the code.

**Step 2 — Normalize encoding before validation.** For sources known to use locale-specific encoding (full-width digits, mixed Unicode normalization forms), apply Unicode normalization (NFKC or equivalent) as the very first operation — before any field extraction, type check, or regex match. This ensures that downstream validation operates on canonical forms and that encoding issues surface as distinct failures rather than false schema errors.

**Step 3 — Validate immediately on first access.** Immediately after receiving data from an external source, assert: required fields are present, column count matches expectation (for CSVs), and critical fields parse to the expected type. Do not defer this to the point of use.

**Step 4 — Fail loudly on mismatch.** Throw a structured validation error rather than silently coercing bad data or skipping malformed rows. The error should include: the source identifier, the expected vs. actual schema (column count, missing fields, type mismatch), and the first-failing field or row. A loud failure at the boundary is always preferable to silent corruption that propagates.

**Optional — Log schema deltas on recurring ingestion.** When re-ingesting a source on a schedule, log a diff of the observed schema against the last known good version. A schema delta is a signal worth surfacing proactively, even when the data is otherwise valid.

A minimal validation gate looks like:

```
function validateSchema(data, expected) {
  // 1. Normalize encoding first
  const normalized = normalizeEncoding(data);

  // 2. Check required structure
  if (normalized.columns.length !== expected.columnCount) {
    throw new ValidationError({
      source: data.source,
      expected: expected.columnCount,
      actual: normalized.columns.length,
      hint: "Column count mismatch — provider may have added or removed fields"
    });
  }

  for (const field of expected.requiredFields) {
    if (!(field in normalized.row)) {
      throw new ValidationError({ source: data.source, missingField: field });
    }
  }

  return normalized; // safe to pass to business logic
}
```

## Evidence

**Taiwan government open-data CSV column shift (production incident)**: A recurring data-pipeline agent consumed government property-transaction CSV files using positional column indexing. The data provider inserted two extra fields mid-row without notice, shifting all downstream column positions. Because there was no upfront column-count assertion, the agent silently read wrong values into every field after the insertion point. The bug surfaced only when consumers noticed anomalous output. Fixing required a three-PR debug chain to identify the root cause, correct the indexing, and add a guard — work that a single upfront `assert row.length === EXPECTED_COLUMNS` would have prevented entirely.

**Full-width CJK digit encoding mismatch (same pipeline, separate incident)**: The same dataset contained addresses using full-width Unicode digits (e.g., `４３號`, Unicode range U+FF10–FF19) rather than ASCII digits. Because encoding normalization was not applied before regex matching, the `\d` pattern produced zero matches on valid address fields. The agent produced geocoding results of 0/500 — a silent total failure. Adding NFKC normalization before any parsing resolved the issue. Both this incident and the column-shift were caught only after propagating through downstream stages; neither would have survived an upfront schema validation gate.

**Recurring schema drift in external APIs**: In agent systems that poll third-party APIs on a schedule, silent schema drift (renamed keys, added wrapper objects, type changes from string to integer) is a documented recurring failure class. The pattern of "works on Monday, broken by Thursday's API deploy" is common enough that several API-dependent agent pipelines now treat schema validation as a required pre-processing step rather than an optional defensive measure.

## Tradeoffs

**Validation overhead**: Adding an explicit schema gate introduces code that must be maintained alongside the data contract. When the provider intentionally changes the schema (new version, added feature), the validation layer must be updated before the agent can process the new data. This is the cost of explicit contracts. The alternative — implicit contracts that silently break — has a higher expected failure cost but a lower upfront maintenance cost.

**False positives on benign additions**: A strict column-count assertion will fail when the provider adds optional fields at the end of a row, even if the agent doesn't need them. Mitigation: validate a minimum column count (`>= EXPECTED`) rather than an exact match when the schema is append-only and trailing fields are safe to ignore.

**Balancing loudness with partial-data recovery**: Failing loudly on any schema mismatch is the safest default but may be too aggressive for pipelines that can safely skip individual malformed rows. When partial ingestion is acceptable, consider row-level validation that logs and skips bad rows rather than aborting the entire batch — but always surface a summary of skipped rows, not silence.
