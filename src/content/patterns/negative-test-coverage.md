---
title: "Negative Test Coverage"
category: "task-design"
evidenceLevel: "strong"
summary: "Agents generating tests focus on happy-path scenarios and achieve high line coverage but low fault-detection power. For every tested behaviour, explicitly add at least one test for an invalid input, error condition, or boundary edge case — the 'one positive, one negative' heuristic."
relatedPatterns: ["verification-before-completion", "empirical-validation-loop", "user-visible-acceptance-criterion-completeness", "schema-validation-before-processing"]
tags: ["testing", "negative-testing", "edge-cases", "error-handling", "boundary-values", "fault-detection", "test-coverage", "quality"]
---

## Problem

An agent generates a test suite for a new module. Every test exercises the happy path: valid inputs produce expected outputs. Line coverage reaches 90–100%. The PR description says "fully tested." CI passes.

Two weeks later, a bug ships. The function silently coerced `null` to `0`. The API returned 500 and the caller swallowed the error. A boundary value (`INT_MAX`, empty array) produced wrong output. None of these paths had tests.

High line coverage on happy-path code is a systematic blind spot in agent-generated test suites. The agent models success by default — it generates tests for the cases the implementation was written to handle. Error paths, invalid inputs, and boundary conditions are structurally underrepresented because they require asking "what breaks?" rather than "what works?"

## Context

This pattern applies whenever an agent is:
- Generating or expanding a test suite for any function, module, or endpoint
- Writing tests as part of a feature implementation sprint
- Reviewing an existing test suite for adequacy
- Working on code that interacts with external resources (APIs, files, databases) or handles user-provided input

The pattern is especially important for:
- Functions with explicit error returns or exception paths
- Code that accepts user-provided or external data (any value in the valid range *and* outside it can appear at runtime)
- External resource accessors where the resource can be unavailable, slow, or malformed
- Functions with documented or implicit preconditions (which are violated in production)

The cost of a missing negative test is asymmetric: it is paid in production, not in CI.

## Solution

**Apply the "one positive, one negative" heuristic:** for every happy-path test case, ask "What would cause this function to fail, return an unexpected value, or throw?" Add that as an additional test case.

If no negative test can be written, document the reason explicitly (e.g., the function is a pure mathematical computation over a type-constrained input with no error path) — in a test-file comment, docstring, or PR description. This makes coverage decisions auditable rather than invisible.

### Negative test categories

| Category | Examples | Prompt cue |
|---|---|---|
| Invalid input | `null`, empty string, wrong type, out-of-range numeric | "What if the caller passes `null` for [parameter]?" |
| Boundary value | `0`, `-1`, `INT_MAX`, empty array, single-element array | "What is the smallest / largest valid input? Test just outside." |
| Error condition | API returns 500, file not found, network timeout | "What if the external dependency fails?" |
| Partial/corrupt data | Missing required field, truncated payload, encoding mismatch | "What if the input is structurally valid but semantically incomplete?" |
| Concurrent/idempotency | Calling twice, calling after teardown, concurrent invocations | "What happens if this is called twice in sequence?" |

### Process for testing existing code

1. Read the function signature: what are the declared parameter types and their valid ranges?
2. For each parameter, identify the valid range and add a test with a value just outside it.
3. Read every branch that returns an error or throws — add a test that exercises each path.
4. For every external resource access (file, API, DB call), add a test where the resource is unavailable or returns an error response.
5. If the function has documented or implied preconditions, test what happens when each precondition is violated.

### Prompt template

When generating tests for any function or module, append:

```
After writing the happy-path test cases, also write at least one test for each of the following where applicable:
- A null or undefined input for each parameter
- A value just outside the valid range for numeric or array parameters
- Each externally observable failure behaviour (function returns an error value, throws, or rejects) — focus on what the caller receives, not which internal branch runs
- A simulated failure for any external resource (API, file, database) accessed by the function

If a category does not apply to this function, state that explicitly (in a test-file comment, docstring, or PR description) rather than omitting the test silently.
```

### Anti-patterns to avoid

- **"The function is well-typed, so I don't need to test bad inputs."** Type systems constrain the static type of an argument, not the runtime value. A `number` parameter can receive `NaN`, `Infinity`, `-1`, `0`, or `2**53 + 1`. Types narrow the surface; they don't close it.
- **Writing only the test cases the implementation currently passes.** Tests should specify intended behavior, not document current behavior. A test that only exercises paths the code handles today will not catch regressions when the code changes.
- **Skipping error-path tests because "that path is rarely hit."** Error paths are rarely hit in development and routinely hit in production. The asymmetry is the reason to prioritize them, not to skip them.
- **Treating 100% line coverage as sufficient.** Line coverage measures which lines execute, not which conditions are tested. An `if (x === null) return error` line can be 100% covered by a single test that passes `null` — without testing what the caller does with the error.

## Evidence

Sprint-generated test suites from an autonomous multi-agent system provide direct evidence of the pattern.

**Full-width digit parsing bug (realestate-radar, June 2026):** A geocoding pipeline successfully geocoded 0 of 500 addresses — a 100% failure rate that only surfaced against live data. Root cause: Taiwan government data uses full-width digits (U+FF10–FF19, e.g. `４３号`) in address strings. The regex `\d` does not match full-width digits. The test suite had 100% line coverage on the happy path (ASCII addresses) and zero tests for non-ASCII digit variants. A single negative test with a full-width digit address — "what if the input uses CJK numerals?" — would have caught the bug before the pipeline ran against live data. This bug recurred in a second project (subsidy-radar) because the test suite pattern was copied without the negative test.

**CSV column-shift bug (realestate-radar, June 2026):** A CSV parser was tested against a fixed-format fixture file with the expected number of columns. The government data source silently added two columns in a format update. The parser accessed fields by fixed index and silently read the wrong columns — it did not reject the input, it produced corrupt output. No test exercised what happened when the column layout shifted. A negative test with an extended-column row that asserted the correct field values (not just "file parsed without error") would have surfaced the silent index-shift before production.

**Null API response handling (multiple incidents, May–June 2026):** Several sprint-generated API client modules were tested only against successful (2xx) responses. Error-path handlers (`catch` blocks, `if (!response.ok)`) existed in the implementation but had zero test coverage. When APIs returned 5xx responses in production, error handlers ran — often with bugs (uncaught secondary errors, silent swallowing of failure state) that had never been exercised. The pattern: implementation has an error path, tests do not cover it, the first production error reveals the error handler was also broken.

**Consistent pattern across 12+ sprints:** A manual audit of 12 consecutive sprint-generated test suites found that 100% included happy-path tests, 83% had no tests for invalid inputs, 92% had no tests for error-condition code paths, and 75% achieved >90% line coverage despite these gaps. High coverage and low fault-detection power coexisted systematically — the structural cause was agent prompts that specified "write tests for the function" without specifying the test's scope relative to error paths.

## Tradeoffs

**Cost**: Writing a negative test requires understanding how the function fails, not just how it succeeds. For simple functions, this is a few minutes of reasoning. For complex multi-path functions with external dependencies, designing good negative tests (mock setup, error injection) can take as long as writing the implementation.

**Risk**: Negative tests can be over-specified. A test that asserts a specific error message or stack trace format breaks when the message changes for legitimate reasons. Prefer asserting the error *type* or *class* over the exact message string. Assert that an exception is thrown; avoid asserting which line it was thrown from.

**Watch out for:**

- **Mocking too deeply**: A test that mocks every external call tests the test setup, not the integration. Use real implementations where practical (test containers, in-process SQLite, local HTTP server) and mocks only for genuinely unavailable or non-deterministic dependencies.
- **Testing implementation details instead of behaviour**: A negative test should verify that calling the function with bad input produces the documented failure response — not that a specific internal validation check was called. If the implementation changes to validate differently but still produce the correct error, the test should still pass.
- **Coverage gaming**: Adding a negative test that hits an error path but doesn't assert the correct outcome (e.g., `try { fn(null) } catch (e) {}` with no assertion) satisfies a coverage tool without testing anything. Assert the thrown value, error code, or returned error object explicitly.

## Related Patterns

- **[Verification Before Completion](/agent-prompt-patterns/patterns/verification-before-completion)** — checks *that* tests pass before declaring a task done; this pattern ensures the test suite has the fault-detection power to make "tests pass" meaningful
- **[Empirical Validation Loop](/agent-prompt-patterns/patterns/empirical-validation-loop)** — running experiments and observing failure cases is the macroscale version of negative testing: both require deliberately probing failure modes rather than confirming success paths
- **[User-Visible Acceptance Criterion Completeness](/agent-prompt-patterns/patterns/user-visible-acceptance-criterion-completeness)** — acceptance criteria should include error cases and invalid input handling, not just success flows; this pattern is the test-side complement
- **[Schema Validation Before Processing](/agent-prompt-patterns/patterns/schema-validation-before-processing)** — validates data shape before acting on it; negative tests for schema validation code are especially high-value because malformed inputs are the most common production failure mode for data pipelines
