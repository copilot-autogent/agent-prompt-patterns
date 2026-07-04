---
title: "Encoding Normalization Before Parsing"
category: "task-design"
evidenceLevel: "strong"
summary: "External data — especially government and international datasets — often contains full-width or locale-specific characters that look like ASCII but break regex and number parsing. Normalize to NFKC canonical form before any regex match, number parse, or field comparison. For Taiwan government data, also decode packed ROC/民國 date integers before year arithmetic."
relatedPatterns: ["schema-validation-before-processing", "hypothesis-before-action"]
tags: ["encoding", "normalization", "unicode", "full-width", "cjk", "taiwan", "roc-dates", "data-pipeline", "task-design", "tier:2-standard", "external-data", "defensive"]
---

## Problem

Government open-data and international datasets frequently contain characters that are visually indistinguishable from ASCII but occupy different Unicode code points. The most common class is **full-width (CJK) digits**: `４３号` uses U+FF14 and U+FF13, not U+0034 and U+0033. JavaScript's `\d` pattern, Python's `[0-9]`, and `parseInt` / `Number()` all treat these as non-numeric — silently.

The failure mode is a total miss with no error:

- A geocoding pipeline runs `address.match(/\d+/)` to strip house numbers. Every address with full-width digits returns `null`. The geocoder receives malformed input and returns zero results. No exception is raised; the output is just empty.
- A date parser calls `parseInt(dateField)` on a field that has been NFKC-normalized elsewhere but not here. The result is `NaN`. Downstream date arithmetic produces `Invalid Date`. Again, no exception — just wrong output.

A second, Taiwan-specific variant: dates in 實價登錄 (real-estate transaction) and other government sources are encoded as **packed ROC/民國 date integers** — six or seven decimal digits where the first two or three digits represent the year in the Republic of China calendar. `741024` means 民國74年10月24日, which is 1985-10-24 in the Gregorian calendar (ROC year + 1911). Code that parses this as a Unix timestamp, a Gregorian year, or a standard date string produces garbage silently:

- `new Date(741024)` → a millisecond-epoch timestamp in January 1970.
- Treating `741024` as the year → a year ~739,000 years in the future.
- `new Date("741024")` → `Invalid Date`.

Both problems share the same root: **external data is treated as structurally equivalent to internal data without an encoding boundary at ingestion.** Tests pass because test data uses ASCII; production fails silently because real data uses locale-specific encodings.

## Context

This pattern applies whenever an agent ingests data from an external source it does not control, particularly when that source:

- Originates from a locale that uses multi-byte character sets (East Asian government data, Unicode-rich CSV exports, international address data).
- Contains numeric fields in human-readable form (house numbers, year fields, date fields) rather than machine-canonical form.
- Is consumed by regex patterns, `parseInt`, `Number()`, or any comparison against numeric literals.

It is most critical for:

- **Taiwan government open-data pipelines** — 實價登錄, 地籍資料, 補助資料, and related datasets routinely use full-width digits in address fields and packed ROC integers in date fields.
- **Geocoding pipelines** — house number extraction depends on digit patterns; a single full-width digit in an address defeats most extractors.
- **Data pipelines with scheduled ingestion** — once the normalization gap is present, every batch silently fails on any record with a full-width character. The failure is invisible until a consumer compares expected vs. actual hit counts.
- **Year-range validation and age calculations** — building age, transaction recency, eligibility windows all require correct Gregorian year derivation from government date fields.

The pattern is less critical for data the agent generates itself, or for API responses from services that document their encoding contract and use UTF-8 with canonical ASCII numerics.

## Solution

### Rule 1 — Normalize NFKC before any regex, parse, or comparison

Apply `str.normalize('NFKC')` (JavaScript) or `unicodedata.normalize('NFKC', s)` (Python) to string fields from external sources **before** any of the following operations:

- Regular expression matching (`\d`, `[0-9]`, digit-anchored patterns)
- `parseInt`, `Number()`, `parseFloat`, or equivalent
- String comparison against ASCII literals
- Further normalization or splitting steps

NFKC (Unicode Compatibility Decomposition followed by Canonical Composition) maps full-width digits (U+FF10–FF19), full-width Latin letters, and other compatibility variants to their ASCII equivalents. It is the correct choice for "make this look like what I expect from a keyboard." It is not lossless for all Unicode — it collapses some semantically distinct characters — but for numeric fields, address fields, and structured identifiers in government data, the lossy cases are not present.

```js
// JavaScript — normalize before any digit operation
function normalizeField(value) {
  if (typeof value !== 'string') return value;
  return value.normalize('NFKC');
}

// Good: normalize first, then match
const normalized = normalizeField(rawAddress); // "４３号" → "43号"
const houseNumber = normalized.match(/\d+/)?.[0]; // "43"

// Bad: match on raw value silently fails (full-width digits don't match \d in JS)
// const badHouseNumber = rawAddress.match(/\d+/)?.[0]; // undefined — full-width \d miss
```

```python
# Python — normalize before any digit operation
import re
import unicodedata

def normalize_field(value: str) -> str:
    return unicodedata.normalize('NFKC', value)

# Good
normalized = normalize_field(raw_address)  # "４３号" → "43号"
house_number = re.search(r'[0-9]+', normalized)  # matches "43"

# Bad — silently returns None (Python's re [0-9] is explicit ASCII, skips full-width digits)
# house_number = re.search(r'[0-9]+', raw_address)  # None
# Note: Python's int("４３") actually succeeds (Python 3 accepts Unicode decimal digits),
# but [0-9] regex, ASCII string comparisons, and float("４３") may still fail on full-width input.
# Normalize before any such operation for consistent behaviour across field types.
```

Normalize at the **ingestion boundary**, not at the point of use. If normalization is deferred to individual callsites, it will be missed at some callsites. A single normalization pass immediately after reading rows from the CSV or parsing the JSON eliminates the entire class of failures.

### Rule 2 — Decode packed ROC/民國 date integers before year arithmetic

Taiwan government date fields are commonly encoded as six- or seven-digit integers in the format `YYYMMDD` where `YYY` is the two- or three-digit ROC year:

| Packed integer | ROC year | Month | Day | Gregorian year |
|---|---|---|---|---|
| `741024` | 74 | 10 | 24 | 1985 |
| `1100315` | 110 | 03 | 15 | 2021 |
| `890601` | 89 | 06 | 01 | 2000 |

Conversion algorithm:

1. Convert to string if necessary.
2. Split: last 4 characters are `MMDD`; everything before is the ROC year.
3. Gregorian year = ROC year + 1911.
4. Reconstruct as a standard date if needed.

```js
/**
 * Parse a packed ROC/民國 date integer.
 * @param {number|string} packed - e.g. 741024 or "741024"
 * @returns {{ year: number, month: number, day: number } | null}
 */
function parseROCDate(packed) {
  const s = String(packed).normalize('NFKC'); // normalize full-width digits first
  // 6 digits = 民國10–99年 (YY MMDD); 7 digits = 民國100–999年 (YYY MMDD)
  // Note: 民國1–9年 (5-digit YMMDD) are not present in 實價登錄 post-1991 data;
  // for datasets predating 民國10年 (1921), widen to /^\d{5,7}$/.
  if (!/^\d{6,7}$/.test(s)) return null;
  const day = parseInt(s.slice(-2), 10);
  const month = parseInt(s.slice(-4, -2), 10);
  const rocYear = parseInt(s.slice(0, -4), 10);
  // Validate month and day ranges before returning
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const gregorianYear = rocYear + 1911;
  return { year: gregorianYear, month, day };
}

// Usage
parseROCDate(741024);   // { year: 1985, month: 10, day: 24 }
parseROCDate(1100315);  // { year: 2021, month: 3,  day: 15 }
parseROCDate("７４１０２４"); // still works — NFKC normalizes full-width digits
```

### Rule 3 — Use a configurable `maxYear` for year-range validation

Year-range guards (e.g., "reject buildings with completion year > current year") frequently use `new Date().getFullYear()`. This makes tests clock-dependent and can produce wrong results in long-running agents that cache the year at startup.

Instead, define `maxYear` as a module-level constant with a default that can be overridden in tests:

```js
// config.js
export const MAX_YEAR = parseInt(process.env.MAX_BUILD_YEAR ?? '', 10) || 2050;

// buildYear.js
import { MAX_YEAR } from './config.js';

export function parseBuildYear(packed, { maxYear = MAX_YEAR } = {}) {
  const parsed = parseROCDate(packed);
  if (!parsed) return null;
  if (parsed.year < 1912 || parsed.year > maxYear) return null;
  return parsed.year;
}
```

This keeps tests deterministic regardless of when they run, and makes the year bound explicit rather than hidden in a `Date()` call.

### Combined ingestion pattern

```js
import { parse } from 'csv-parse/sync';

// Structured fields in this dataset that contain encoded numeric/date data.
// Scope NFKC normalization to these fields to avoid lossy changes to free-text columns.
const STRUCTURED_FIELDS = ['address', 'district_code', 'completion_date', 'transaction_date'];

function ingestGovCSV(rawBuffer) {
  // Note: rawBuffer must already be decoded from the source charset (e.g., Big5 → UTF-8)
  // before NFKC normalization — NFKC operates on Unicode code points, not raw bytes.
  const rows = parse(rawBuffer, { columns: true, bom: true });

  return rows.map(row => {
    // Step 1: normalize structured fields at the boundary (scoped, not global)
    const normalized = { ...row };
    for (const field of STRUCTURED_FIELDS) {
      if (typeof normalized[field] === 'string') {
        normalized[field] = normalized[field].normalize('NFKC');
      }
    }

    // Step 2: parse ROC date fields; use parseBuildYear for year-range bounds check
    const completionYear = parseBuildYear(normalized.completion_date) ?? null;

    return {
      ...normalized,
      completionYear,
    };
  });
}
```

## Evidence

**realestate-radar #107–#109 — 3-PR geocoding debug chain**: A geocoding pipeline matched `\d+` against address strings from 實價登錄 CSV exports to strip house numbers before passing addresses to a geocoder. The regex returned `null` on every address containing full-width digits (e.g., `台北市中山區４３號`). The geocoder received malformed stripped addresses and returned 0 hits out of 500. No exception was raised; the output was simply empty. The bug required three separate PRs to isolate because the failure manifested far from the encoding mismatch (PR #107: land parcel IDs passed to Nominatim; PR #108: house numbers not stripped; PR #109: full-width digits). Root cause: `\d` does not match U+FF14. Fix: `address.normalize('NFKC')` before all regex operations. After the fix, geocoding hit rate recovered from 0/500.

**realestate-radar #134 (`parseBuildYear`) — ROC integer date parsing**: Building completion year fields in 實價登錄 data are six-digit packed ROC integers. An initial `parseBuildYear` implementation passed the integer directly to consumers without ROC→Gregorian conversion, resulting in years like `741024` being used directly in age calculations. Buildings appeared to be ~739,000 years old. Fix: split the integer as `YYYMMDD`, add 1911, add a configurable `maxYear` cap. The configurable cap was required because `new Date().getFullYear()` caused test flakiness when the test ran near a year boundary in CI.

**Pattern: test data uses ASCII, production data uses full-width**: In both incidents, unit tests used manually constructed test data with ASCII digits and passed before and after the bug was introduced. The full-width failure is invisible until the pipeline runs against real government exports. This gap motivates adding at least one test case with full-width digit inputs to any function that operates on government data fields.

## Tradeoffs

**NFKC is not fully lossless**: NFKC compatibility decomposition collapses some Unicode characters that are semantically distinct in certain contexts (e.g., ligatures, some mathematical symbols, certain CJK compatibility ideographs). For numeric fields, address fields, and structured identifiers from government data, none of the lossy cases are present. For free-text content that may be displayed to users (names, descriptions), global NFKC normalization should be applied with awareness that some display variants will be collapsed. The recommendation is to normalize at the field level, scoped to fields known to contain structured data, rather than globally across all content.

**ROC date decoding is Taiwan-specific**: The `parseROCDate` pattern applies specifically to Taiwan government sources. Applying it to non-ROC date fields (e.g., an ISO 8601 date or a Unix timestamp) will produce wrong results. Scope the decoder to fields documented in the data dictionary as ROC-era dates. Label those fields explicitly in the schema specification (see `schema-validation-before-processing`).

**Normalization at ingestion vs. callsite**: Normalizing at the ingestion boundary (immediately after reading rows) is preferred over normalizing at each callsite. Boundary normalization ensures no callsite is missed; callsite normalization requires every future maintainer to remember to add `.normalize('NFKC')` to every new field access. The cost of boundary normalization is a single pass over the row; this is negligible relative to the I/O cost of the ingestion itself.
