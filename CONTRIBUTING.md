# Contributing to Agent Prompt Patterns

Thank you for your interest in contributing! This library is a curated collection of empirically-tested prompt patterns for AI coding agents.

## Scope: Tool-Agnostic Patterns Only

**This library focuses on reusable patterns that work across different agent frameworks and tools.**

### ✅ In Scope

Patterns that can be applied to any AI coding agent system:
- **Framework-neutral**: Works with GitHub Copilot, Claude Code, Cursor, Aider, or any other agent tool
- **Transferable concepts**: Observation-resolution pairing, memory discipline, decision ownership
- **Generic terminology**: "agent", "persistent storage", "scheduled job", "session"

### ❌ Out of Scope

- **Tool-specific features**: Patterns that only work with one specific tool or API
- **Implementation details**: Exact API calls, specific CLI commands, proprietary tool names
- **Configuration recipes**: How to set up a specific framework
- **Meta-commentary**: Patterns about maintaining *this* pattern library itself

**The test**: Would this pattern be useful to someone using a *different* agent tool than the one where you discovered it?

## Pattern Structure

Every pattern must follow this structure:

```markdown
---
title: "Pattern Name"
category: "category-name"
evidenceLevel: "emerging"
summary: "One-sentence pattern description"
relatedPatterns: ["other-pattern-slug"]
tags: ["tag1", "tag2", "tag3"]
---

## Problem
What goes wrong? (2-3 paragraphs)

## Context
When does this apply? When doesn't it? (2-3 paragraphs)

## Solution
How to fix it? (3-5 paragraphs with examples)

## Evidence
Real data, before/after measurements, incidents (2-3 paragraphs)

## Tradeoffs
Benefits, costs, watch-outs (2-3 paragraphs)

## Related Patterns
- **[Pattern Name](/agent-prompt-patterns/patterns/slug)** — relationship
```

### Categories

Must be one of:
- `prompt-structure` — How to structure prompts and instructions
- `task-design` — How to break down and route work
- `agent-autonomy` — Decision-making and self-directed behavior
- `feedback-loops` — Learning and memory across sessions
- `multi-agent` — Coordination and orchestration
- `memory-management` — Storage topology, recall quality, and memory pruning

### Evidence Levels

- `emerging` (`[+--]`) — Initial observations, <5 data points
- `promising` (`[++-]`) — Repeated pattern, 5-15 data points
- `strong` (`[+++]`) — Well-validated, >15 data points or production incident data

## Empirical Evidence Requirement

**Every pattern needs real evidence**, not hypothetical benefits:

✅ **Good evidence**:
- "Across 15 sessions, the completion rate went from 0% to 100%"
- "Production incident on May 22: agent silently overwrote 4 work items"
- "Measured latency: 847ms → 203ms after applying pattern"

❌ **Not evidence**:
- "This should improve reliability"
- "In theory, this would prevent errors"
- "Best practice suggests..."

## Anonymization

**Replace tool-specific terms** with generic equivalents before submitting:

| Tool-specific ❌ | Generic ✅ |
|-----------------|-----------|
| "autogent memory topic" | "persistent storage location" |
| "spawn_task" | "scheduled follow-up agent" |
| "Discord channel" | "chat channel" |
| "PLAYBOOK.md" | "operational guidelines" |

## Submitting a Pattern

1. **File an issue first**: Describe the pattern and share evidence
2. **Get feedback**: Maintainers will confirm it's in scope
3. **Create a branch**: `feat/pattern-your-pattern-name`
4. **Write the pattern**: Follow the structure above
5. **Build locally**: `npm run build` must pass
6. **Open a PR**: Reference the issue with `Closes #N`

## Questions?

Open an issue with the `question` label. We're happy to help!
