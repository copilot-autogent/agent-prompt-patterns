---
title: "Schema Validation Before Processing"
category: "task-design"
evidenceLevel: "moderate"
summary: "External data pipelines break silently when providers change column layouts or remove fields; assert schema at ingestion, normalize encoding on affected fields first, and throw a structured error on any mismatch."
relatedPatterns: ["input-trust-classification", "empirical-validation-loop", "large-tool-output-guard", "negative-test-coverage", "data-feasibility-probe"]
tags: ["data-pipeline", "validation", "schema", "defensive", "external-data", "encoding", "error-handling"]
---

## Problem

Agents that process external data — API responses, CSV exports, government open-data files, JSON payloads — commonly assume that the data structure matches the expected layout at call time. This assumption works until it doesn't: a data provider inserts two extra columns mid-row, removes a previously-required field, changes a numeric field to a string, or switches character encodings.

When schema drift occurs without upfront validation, three failure modes compound:

**Silent data corruption**: If column positions shift in tabular data, positional indexing (`row[5]`) silently reads the wrong field. The agent processes the data without error, producing incorrect output that propagates downstream before anyone notices. By the time the bug surfaces in a consumer or report, tracing back to the schema shift requires forensic investigation.

**Cryptic runtime errors**: Without a schema boundary, type mismatches surface as null pointer exceptions, regex mismatches, or parse failures deep in processing code — far from the data ingestion point. The error message references the symptom, not the cause. A validation error at ingestion would be immediately actionable; a crash in the fourth transformation stage is not.

**Encoding traps**: Data sources from locales that use multi-byte character sets (e.g., full-width CJK digits in East Asian government datasets) produce field values that contain semantically numeric content but don't match ASCII character class patterns like `[0-9]`. Running type checks or regex parsing on unnormalized encoding produces false validation failures or silent mismatches that are indistinguishable from genuine schema errors.

## Context

This pattern applies to any agent that ingests data from sources it does not control: third-party APIs, government open-data portals, uploaded files, database exports, or any pipeline that crosses an organizational boundary.

It is most critical when:

- **Column-indexed tabular data** is consumed (CSV, TSV, spreadsheet exports) — positional indexing is fragile to any column insertion or removal.
- **Recurring ingestion pipelines** re-fetch the same source on a schedule — the schema that was valid last week may not be valid today.
- **Data crosses locale or encoding boundaries** — sources using full-width characters, BOM-prefixed files, or mixed encodings require special handling before structural validation: BOM markers must be stripped at decode time (before header parsing), and field-level encoding normalization applied before type-checking.
- **Downstream consumers depend on field presence and type** — a missing field that defaults to `null` without notice can cascade into incorrect computations or silent omissions.

The pattern is less critical for data the agent generates itself (e.g., writing a JSON file and immediately reading it back) or for fixed, well-tested internal API contracts with strong versioning guarantees.

## Solution

Apply schema validation as a mandatory gate between data ingestion and business logic. Structure the validation as four explicit steps:

**Step 1 — Enumerate expected structure before writing processing code.** Document the schema as a first-class artifact: field names, column order (for tabular data), required vs. optional fields, data types, value constraints, and encoding expectations. This forces the schema assumption to be explicit rather than implicit in the code.

**Step 2 — Normalize encoding on affected fields before validation.** For sources with BOM-prefixed files, strip the BOM at decode time before header parsing (a BOM on the first byte of the header causes the first column name to never match). For sources using locale-specific digit or character encoding (full-width digits, mixed Unicode normalization forms), apply Unicode normalization (NFKC or equivalent) to the specific fields that require it — before any type check or regex match. Scope normalization to the fields that need it: applying compatibility normalization globally is lossy and can alter semantically meaningful identifiers or free-text content.

**Step 3 — Validate immediately on first access.** Immediately after receiving data from an external source, assert in order: (a) header names are unique and match expected column list; (b) column count matches expectation — both at the header level and per-row (a valid header can coexist with malformed rows); (c) required fields are present in each record; (d) critical fields parse to the expected type (not merely present but non-null and parseable).

**Step 4 — Fail loudly on mismatch.** Throw a structured validation error rather than silently coercing bad data or skipping malformed rows. The error should include: the source identifier, the expected vs. actual schema (column count, missing fields, type mismatch), and a reference to the first-failing field. Avoid including raw field values in error messages when data may contain sensitive content — log field names and positions, not values.

**Optional — Log schema deltas on recurring ingestion.** When re-ingesting a source on a schedule, log a diff of the observed schema against the last known good version. A schema delta is a signal worth surfacing proactively, even when the data is otherwise valid.

A minimal validation gate looks like:

```js
function validateSchema(data, expected) {
  // Step 2: strip BOM at decode time, then normalize encoding on specific fields
  const decoded = stripBOM(data.raw);
  const normalized = normalizeEncodingOnFields(decoded, expected.encodedFields);

  // Step 3a: check header uniqueness before mapping to objects
  const headers = normalized.columns;
  if (new Set(headers).size !== headers.length) {
    throw new ValidationError({ source: data.source, issue: "Duplicate header names" });
  }

  // Step 3b: check column count at header level
  if (headers.length !== expected.columnCount) {
    throw new ValidationError({
      source: data.source,
      expected: expected.columnCount,
      actual: headers.length,
      // Do not include raw column values — they may contain sensitive data
    });
  }

  // Step 3b: check per-row column count (header may pass while rows drift)
  for (const row of normalized.rows) {
    if (row.length !== expected.columnCount) {
      throw new ValidationError({ source: data.source, rowColumnCount: row.length });
    }
  }

  // Map headers to objects, then check field presence and parseability
  const records = normalized.rows.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
  );

  for (const record of records) {
    for (const field of expected.requiredFields) {
      // Step 3c: required field present
      if (!Object.hasOwn(record, field) || record[field] == null || record[field] === "") {
        throw new ValidationError({ source: data.source, missingField: field });
      }
      // Step 3d: critical fields parse to expected type
      if (expected.numericFields.includes(field) && isNaN(Number(record[field]))) {
        throw new ValidationError({ source: data.source, unparsableField: field });
      }
    }
  }

  return records; // safe to pass to business logic
}
```

## Evidence

**Government open-data CSV column shift (production incident)**: A recurring data-pipeline agent consumed government property-transaction CSV files using positional column indexing. The data provider inserted two extra fields mid-row without notice, shifting all downstream column positions. Because there was no upfront column-count assertion, the agent silently read wrong values into every field after the insertion point. The bug surfaced only when consumers noticed anomalous output. Fixing required a three-PR debug chain to identify the root cause, correct the indexing, and add a guard — work that a single upfront `assert row.length === EXPECTED_COLUMNS` would have prevented entirely.

**Field-level encoding normalization gap (same pipeline, separate incident)**: The same dataset contained address fields using full-width Unicode digits (e.g., `４３号`, Unicode range U+FF10–FF19) rather than ASCII digits. Because encoding normalization was not applied to those fields before regex matching, the `[0-9]` pattern produced zero matches on valid address values. The agent produced geocoding results of 0/500 — a silent total failure. This is a content/encoding validation problem distinct from structural schema drift, but it is prevented by Step 2 of the pattern when the schema specification explicitly documents expected encoding for each field and normalizes before type-checking those fields.

**Recurring schema drift in external APIs**: In agent systems that poll third-party APIs on a schedule, silent schema drift (renamed keys, added wrapper objects, type changes from string to integer) is a documented recurring failure class. The pattern of "works on Monday, broken by Thursday's API deploy" is common enough that several API-dependent agent pipelines now treat schema validation as a required pre-processing step rather than an optional defensive measure.

## Tradeoffs

**Validation overhead**: Adding an explicit schema gate introduces code that must be maintained alongside the data contract. When the provider intentionally changes the schema (new version, added feature), the validation layer must be updated before the agent can process the new data. This is the cost of explicit contracts. The alternative — implicit contracts that silently break — has a higher expected failure cost but a lower upfront maintenance cost.

**False positives on benign additions**: A strict column-count assertion will fail when the provider adds optional fields at the end of a row, even if the agent doesn't need them. Mitigation: validate a minimum column count (`>= EXPECTED`) rather than an exact match when the schema is append-only and trailing fields are safe to ignore.

**Balancing loudness with partial-data recovery**: Failing loudly on any schema mismatch is the safest default but may be too aggressive for pipelines that can safely skip individual malformed rows. When partial ingestion is acceptable, consider row-level validation that logs and skips bad rows rather than aborting the entire batch — but always surface a count of skipped rows with field-level failure reasons, not silence.
