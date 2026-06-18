---
title: "User-Visible Acceptance Criterion Completeness"
category: "task-design"
evidenceLevel: "moderate"
summary: "When a sprint's acceptance criteria require the user to see or interact with a feature, the rendering/wiring path is in-scope by default — not a follow-up. Deferring UI hookup while closing the issue produces merged PRs that deliver zero user value and create perceived \"no progress\" despite real work."
relatedPatterns: ["follow-through-discipline", "side-effect-verification", "structured-handoff-header"]
tags: ["task-design", "acceptance-criteria", "sprint-planning", "ui-rendering", "deferred-work", "user-value", "invisible-work"]
---

## Problem

A sprint ships a feature completely — backend logic implemented, tests pass, PR merged — but defers the user-visible rendering to "a follow-up sprint." The follow-up sprint is mentioned as prose ("out of scope for now"), never filed as a tracked issue. The next sprint picks up something else. The feature exists in code but is invisible to users.

**Incident anatomy (shogi-srs, June 2026):**

- Sprint #99: shipped contrast-aware prose generation → deferred `PuzzlePlayer.svelte` rendering → "no improvement" in user dogfood
- Sprint #100: shipped threat delta analysis → deferred display wiring → invisible
- Sprint #105: shipped extended features → deferred UI hookup → invisible
- All three closed their parent issues with `Closes #N`; all three had user-facing acceptance criteria
- User dogfooded after all three merges: "I didn't notice any improvement"

3 sprints × ~1 week each = ~3 weeks of perceived "no progress" despite 3 merged PRs. Sprint velocity metrics (PRs merged, lines added) diverged completely from user-visible progress.

**The root failure:** The sprint scope defined "backend ready" as sufficient — but the issue's acceptance criteria were user-facing ("user should see X"), not backend-only ("unit tests pass"). A backend module that is "ready to be imported" delivers zero user value until something imports it.

**Detection signal:** Any PR body containing "Out of scope: wiring into `<Component>`" / "ready to be imported" / "UI hookup in a follow-up" on an issue whose acceptance criterion is user-facing.

## Context

This pattern applies to any sprint-based workflow where:

- Issues have user-facing acceptance criteria ("user should see X", "user can do Y")
- Issues are closed on merge without verifying the user-visible path

Common scenarios: fullstack projects where backend and frontend are in separate files; same-file implementations where rendering is conditional; feature-flag rollouts where the flag is never flipped; config-only wiring gaps where an integration is "supported" but not enabled.

It is especially important for:

- Weekly sprint cycles where follow-up tracking is low-fidelity
- Autonomous sprints without a human checking "does the UI actually show this?"
- Projects where backend and UI work are routinely split into separate tasks (high risk that the UI task is never filed)

It does **not** apply when the issue's acceptance criteria are backend-only ("unit tests pass", "API returns correct response"). Deferring UI is fine when the issue explicitly scopes to backend with no user-visible acceptance criterion.

## Solution

**Classify the acceptance criterion before defining scope:**

| Acceptance criterion type | Example | Rendering scope |
|---|---|---|
| Backend-only | "Unit tests pass", "API returns correct JSON" | Deferral OK |
| User-visible | "User can see X", "User can do Y", "Contrast feels relevant ≥70%" | Rendering is in-scope |

**Four rules for user-visible acceptance criteria:**

1. **The rendering path is in-scope by default.** If users must see/interact with the feature for the acceptance criterion to be met, the display wiring is the load-bearing part — not out-of-scope. Scope the sprint to include wiring.

2. **"Backend ready to be imported" = 0% user value.** A module that implements a feature but isn't imported by any UI delivers zero value until wiring is complete. Do not close the issue as "done" in this state.

3. **If rendering must be deferred, file the follow-up BEFORE closing, and do NOT close the parent.** Not "follow-up sprint" as prose — a numbered GitHub issue with explicit acceptance criteria. The original issue remains open until the rendering is merged and the user can actually see/interact with the feature.

4. **Explicit issue number = commitment.** "Backend ships in #N, rendering tracked in #M (open)" is acceptable. "I'll wire it up later" is not — sessions are stateless and "later" rarely arrives.

**Checking the sprint prompt (pre-dispatch self-check):**

```
Does this sprint's acceptance criterion include any user-visible behavior?
  YES → rendering/wiring is in-scope; include it in this sprint
  NO  → backend-only; deferred wiring is OK

If YES and rendering truly cannot fit in this sprint:
  1. File a tracking issue NOW (not "later")
  2. Keep the original issue OPEN — close it only when rendering is merged
     and the user can actually see/interact with the feature
  3. Reference the tracking issue number in any PR description or comment
     (so reviewers know the rendering is explicitly tracked, not forgotten)
```

**PR review signal:**

When reviewing a PR on a user-visible issue, the question is not whether specific phrases appear in the PR body — it is whether the user can actually meet the acceptance criterion after the merge. Reject if:

- The acceptance criterion is user-visible AND the rendering is unimplemented AND no tracked follow-up issue number is cited
- The PR claims "done" or closes the parent issue while the user-visible path is unimplemented, regardless of how that deferral is worded

Note: touching rendering code is not sufficient — a flagged-off, dead-path, or wrong-route render still fails the acceptance criterion. The gate is: **"After this merge, can the user actually do/see the thing the issue requires?"** — not "did we touch rendering files?"

## Evidence

**Shogi-srs incident (June 2026):**

- 3 consecutive sprints (#99, #100, #105) shipped backend logic, deferred `PuzzlePlayer.svelte` rendering
- All three closed their parent issues with `Closes #N`
- All three had user-facing acceptance criteria (dogfood acceptance, contrast relevance ≥70%, user-visible feature display)
- First dogfood session after all three merges: "I didn't notice any improvement"
- The contrast prose from sprint #99 was predating all three merges in the user's view
- Follow-up rendering sprints were mentioned as prose in each PR body; none were filed as tracked issues; none were picked up by the dispatcher

**Evidence level: moderate** — single project incident with a clear causal chain (deferred rendering → acceptance criteria structurally unmet → user perceives no progress). The pattern captures a failure mode that is structural (not incidental to shogi-srs) and applicable to any fullstack sprint workflow.

## Tradeoffs

**Benefit**: User-visible progress tracks with sprint velocity. The "merged PRs" metric and the "user sees improvement" metric converge.

**Cost**: Sprints that include rendering are larger. The sprint agent must touch both backend and frontend files, increasing the risk of merge conflicts and wider review surface.

**Watch out for:**

- **"The rendering is trivial, I'll add it at the end"** — if rendering is in-scope, include it in the sprint plan explicitly, not as an afterthought. Trivial wiring is often less trivial than expected (prop threading, state management, conditional display).
- **Filing a rendering issue and forgetting it** — a filed issue with no way to be tracked is invisible. Apply whatever label or status marker your project uses to keep it visible and prioritized; an unfiled "will do later" is no better than a filed-but-abandoned issue.
- **Accepting "out of scope" framing from an autonomous sprint** — the sprint agent will often frame rendering as out-of-scope to reduce its own task size. The human reviewer or the PR pipeline must enforce the rendering-is-in-scope rule at review time.
- **Closing sub-issues before the parent is verified** — if a parent issue has user-facing acceptance criteria, the parent should not be closed until the user can actually see or interact with the feature through the normal product UI (not just that "a file exists that could render it").

## Related Patterns

- **[Follow-Through Discipline](/agent-prompt-patterns/patterns/follow-through-discipline)** — the explicit "file a follow-up issue with a number before closing" rule is an application of follow-through discipline to the rendering gap; "later" without a trigger is not a plan
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — both patterns address invisible work; side-effect verification checks "did the tool actually do what it claimed?"; this pattern checks "does the merged code actually produce a visible outcome for the user?"
- **[Structured Handoff Header](/agent-prompt-patterns/patterns/structured-handoff-header)** — sprint prompts with a `success_criteria` field in the HANDOFF_CONTEXT header are the correct enforcement point: listing "user can see X in the UI" as a success criterion makes the rendering requirement explicit and reviewable at handoff time
