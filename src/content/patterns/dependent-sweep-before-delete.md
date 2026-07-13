---
title: "Dependent Sweep Before Delete"
category: "agent-autonomy"
evidenceLevel: "strong"
summary: "Before deleting or renaming any resource — a file, slug, module, API endpoint, or exported symbol — search the entire codebase for all references to that resource and update or remove every reference in the same operation. A deletion that leaves dangling references is incomplete: it will compile locally, pass unit tests, and only fail at build time or silently at runtime, often after a successful merge."
relatedPatterns: ["pre-destruction-state-revalidation", "side-effect-verification", "schema-validation-before-processing", "sprint-completion-verification"]
tags: ["destructive-action", "reference-integrity", "deletion", "rename", "dangling-reference", "build-failure", "agent-autonomy", "codebase-sweep"]
---

## Problem

An agent deletes a resource — a markdown file, a library module, an API slug, a renamed symbol — and the deletion feels complete: the file is gone, local builds pass, unit tests are green. But other parts of the system still hold references to the now-absent resource. Those references survive CI (linters and unit tests don't catch semantic cross-file references) and surface only at build time or runtime, sometimes silently.

The failure modes by reference type:

- **Build-time throw-guards**: Config files that enumerate resources (learning paths, category indexes, nav trees, routing tables) often have explicit validation code that `throw`s on unknown entries. Deleting the resource breaks the build — the site never deploys, but `verify_deploy` returns HTTP 200 on the stale last-good build, giving a false "live" signal.
- **Silent dead code**: A module is removed from the codebase but never cleaned from the build or import graph. The module is gone but referencing import statements (or their absent counterpart) leave an unreachable code path. Alternatively, a new module is created but the entry-point import is never added — all tests pass (they import the module directly), but the feature never renders in production.
- **Runtime 404s**: A slug rename leaves old URLs in internal links, breadcrumbs, or `relatedPosts` frontmatter. The old links 404. Users hit dead pages. No test catches it because tests operate on the new slug.
- **Data integrity breaks**: A symbol rename in a library updates the definition but misses call sites. The call sites still compile (TypeScript sees the old symbol via the old import path), tests run against the old symbol, and the rename goes undetected until the old path is also removed — at which point multiple files break simultaneously.

The consistent failure mechanism: **the agent's verification scope is too narrow**. It verifies that the target resource is gone. It does not verify that everything that depended on the target has been updated.

## Context

This pattern applies to any agent action that removes or renames a resource that other parts of the system might reference:

- **File deletion or consolidation** (merging two markdown posts into one)
- **Slug or URL change** (renaming a content file changes its derived slug)
- **Module rename or removal** (JavaScript/TypeScript module moved, split, or deleted)
- **API endpoint deprecation** (an endpoint's path or method signature changes)
- **Symbol rename** (a function, class, or exported constant gets a new name)
- **Configuration entry removal** (removing a key from a shared config or enum)

The pattern also applies in reverse: **when adding a new resource**, verify it is actually referenced by the entry points that need it. A module added but never imported into the application entry point produces dead code — all unit tests pass (they import the module directly), but the feature never renders. The sweep question changes from "what still references the old resource?" to "does anything reference the new resource where it must be wired in?"

It does NOT apply to:
- **Idempotent or additive changes to list entries** (appending a new valid entry to a config list has no dangling-reference risk, as long as the new entry itself exists)

The pattern is most critical in codebases with build-time validation: Astro content collections, Zod schemas, TypeScript strict mode with path aliases, and any config file with explicit "unknown key" guards. These codebases convert dangling references from silent runtime failures into hard build failures — which is better for reliability, but makes incomplete deletions immediately catastrophic.

## Solution

### Step 1 — Identify all reference identifiers before touching the resource

Before making any change, list every identifier other code might use to reach this resource:

| Resource type | Identifiers to sweep |
|---|---|
| Markdown/content file | Filename stem (slug), full path, `relatedPosts` value, any explicit `id` or `slug` frontmatter field |
| JavaScript/TypeScript module | Relative import path (`../lib/moduleX`), package-relative path (`@/lib/moduleX`), exported symbol names |
| API endpoint | Path string (`/api/v1/users`), path parameter patterns, any client-side fetch call string |
| Config entry / enum value | The exact string or constant value used in config files |
| Exported symbol | Symbol name, any re-export aliases |

### Step 2 — Run a broad codebase sweep for each identifier

Use `grep -r` (or equivalent) across the **entire repository** — not just `src/`, not just adjacent files. Include root-level configs, build scripts, CI workflow files, and package metadata:

```bash
# Slug or filename stem — sweep all directories
grep -r "mcp-tool-poisoning" .

# Module import/export/dynamic-import paths (multiple patterns needed)
grep -r "moduleX" src/             # broad name match first
grep -r "import.*moduleX" src/     # static import
grep -r "from.*moduleX" src/       # re-export / named import
grep -r "export.*from.*moduleX" src/  # barrel re-export
grep -r "import(.*moduleX" src/    # dynamic import()
grep -rP "require\(.*moduleX" src/ # CommonJS require

# API path string — include client code, tests, and CI scripts
grep -r "/api/v1/users" src/ tests/ .github/

# Config entry or enum value — sweep data, content, and CI
grep -r "mcp-tool-poisoning" src/data/ src/content/ .github/
```

Cast the net wider than feels necessary. A slug referenced in a learning-path config file lives two directories away from the content file — it will not be found by a directory-scoped search.

### Step 3 — Audit every hit

For each reference found:

1. **Is this reference still valid after the change?**
   - If the resource is deleted: the reference must be removed or replaced with a valid alternative.
   - If the resource is renamed: the reference must be updated to the new name.

2. **Is this reference in a build-time validation file?** (Config files, content schemas, index enumerations, routing tables, nav structures.) These are the most dangerous: they often have explicit `throw` guards that convert a dangling reference into a hard build failure. Mark these as **high-priority** in the sweep.

3. **Is this reference in a test fixture or mock?** Tests that reference the old identifier will fail silently (they still import the old thing) or loudly (they import a path that no longer exists). Either way, update them.

### Step 4 — Include all reference updates in the same commit as the deletion

Do not split "delete the resource" and "remove its references" across separate PRs or commits. The repository must be in a consistent, buildable state at every commit. A PR that deletes a slug but leaves it in a config file will fail the build on merge — even if the reviewers approved each change individually.

Commit structure:
```
feat: consolidate mcp-tool-poisoning into tool-poisoning-malicious-mcp-servers

- Remove mcp-tool-poisoning.md (content absorbed)
- Update src/data/learning-paths.ts: replace "mcp-tool-poisoning" slug with "tool-poisoning-malicious-mcp-servers"
- Update related-posts frontmatter in 3 files referencing the old slug
```

### Step 5 — Verify via build conclusion, not HTTP status

After merging, confirm the actual build job succeeded — not just `verify_deploy` on the base URL.

`verify_deploy` (HTTP GET on the base URL) returns 200 on the **stale last-good build** even when the new build failed. The site appears live. The deletion appears verified. The breakage is invisible until someone notices the site hasn't updated in hours.

Instead:
1. Pull the Actions run for the **deployed commit SHA** (for squash merges, this is the squash commit SHA; for rebase merges, the tip of the rebased branch; for merge commits, the merge commit SHA).
2. Confirm the **build job** concluded `success` (not just that the API responded 200).
3. Confirm the new content or change is visible in the live site — fetch a specific new URL, check a content marker present only in the new build, or verify the page timestamp advanced past the merge time.

### Decision Checklist

Before any deletion or rename:

```
[ ] Have I listed every identifier other code might use to reach this resource?
[ ] Have I run a broad codebase sweep for each identifier?
[ ] Have I explicitly swept build-time validation files (config, schemas, indexes)?
[ ] Have I audited every reference hit and updated/removed it?
[ ] Are all reference updates in the same commit as the deletion?
[ ] After merge: did I verify the actual build job conclusion (not just HTTP 200)?
```

## Evidence

### ai-security-blog consolidation break (2026-07-12)

A consolidation sprint deleted `mcp-tool-poisoning.md` (its content was absorbed into `tool-poisoning-malicious-mcp-servers`). The deletion itself was correct, but the sprint left the slug `"mcp-tool-poisoning"` referenced in `src/data/learning-paths.ts` (the `"red-team-offense"` learning path entry).

The Astro build has explicit throw-guards on unknown slugs: `throw new Error('Learning path "red-team-offense" references unknown slug "mcp-tool-poisoning"')`. The build failed. GitHub Pages deploy was skipped. The site remained on the prior build.

**The false positive**: The sprint's own `verify_deploy` returned HTTP 200 (the stale last-good build was still served) and the sprint self-reported "verified live." The breakage was only detected when a post-merge deploy-conclusion check found the build job had failed.

**The fix**: Hotfix commit `94d6eae` removed the dead slug reference from `learning-paths.ts`. Build succeeded. Site updated.

**What a dependent sweep would have shown**: `grep -r "mcp-tool-poisoning" src/data/` → `src/data/learning-paths.ts:  slug: "mcp-tool-poisoning"` → one hit, requires update, already identified before the deletion was committed.

### factor-dashboard dead-module pattern

A sprint added a new library module (`src/lib/factorMomentum.js`) and a corresponding test suite (38 passing tests). The module was never imported into `index.astro` — the entry point that wires modules into the dashboard. All 38 unit tests passed (they imported from `src/lib/` directly). The feature never rendered in production.

The PR was merged on a "✅ green tests" signal. A completeness check that swept `index.astro` for the new module's import would have caught the missing wire-up before merge.

This is the mirror failure: not "deleted resource left in a reference" but "new resource never added to the reference graph." The same sweep discipline applies — for any new module, verify that something references it. For any deleted module, verify that nothing still references it.

## Relationship to Related Patterns

**`pre-destruction-state-revalidation`**: Re-validates the *target's own live state* before executing the destructive action (e.g., confirming a sprint's PR merged before killing it). This pattern checks the *dependents* — everything that pointed to the target. They are orthogonal: pre-destruction-state-revalidation answers "is the target in the state I think it is?"; this pattern answers "what else will break when the target is gone?"

**`side-effect-verification`**: Verifies that the side effects of an action (commit, push, deploy) actually occurred. That pattern runs *after* the operation. This pattern runs *before* the deletion. They compose: sweep for dependents before deleting; verify the build actually completed after merging.

**`schema-validation-before-processing`**: Validates that input data conforms to an expected schema before operating on it. Related in spirit (validating consistency before acting), but scoped to input data rather than to the resource graph of the codebase being modified.

**`sprint-completion-verification`**: Verifies that a sprint's deploy concluded successfully by checking the build job conclusion rather than just the HTTP status. Directly addresses the "verify_deploy returns 200 on stale build" failure mode described in the evidence above. This pattern should be applied as the final step of any deletion/rename PR.
