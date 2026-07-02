---
title: "Memory vs. Session-State Separation"
category: "memory-management"
evidenceLevel: "moderate"
summary: "Multi-session agents conflate persistent knowledge storage with transient session logs, causing memory bloat, recall noise, and false continuity. Separate storage by intent: use memory only for synthesized knowledge that cannot be re-derived, use session-store for conversation history and sprint outcomes, and use external repositories for resolved archival records."
relatedPatterns: ["read-before-write-memory-guard", "strategic-memory-recall", "belief-entropy-checkpointing"]
tags: ["memory", "session-state", "storage", "recall", "continuity", "pruning", "knowledge-management"]
---

## Problem

Multi-session agents typically maintain two storage systems: a persistent memory store (for knowledge that should survive across sessions) and a session history store (for conversation transcripts). When agents conflate these systems — saving session narratives to persistent memory — three compounding failure modes emerge.

**Memory bloat**: The agent saves session logs ("sprint #42 completed, issue #12 closed, user asked about deployment") as persistent memory topics. These logs grow unbounded. In one documented production system, memory expanded from 16 to 73 topics in 3 days after a post-wipe recovery period; 26 of those topics (35.6%) were session logs and compaction summaries — not knowledge.

**Recall noise**: When querying persistent memory for project context, session logs contaminate the results. Searching for "project-dashboard" returns both the useful project manifest (signal) and three stale session logs describing what happened during those sessions (noise). Measured noise-to-signal ratio reached 2:1 in the production system described above.

**Utility-score gaming**: Session logs are recalled frequently *within their own session* — the agent reviews the current session log many times. This artificially inflates utility scores, causing the pruning heuristic to classify session logs as high-value knowledge and spare them from deletion. The logs never get pruned despite having zero cross-session value.

## Context

This pattern applies to any multi-session agent architecture where both persistent storage (vector DB, markdown files, key-value store) and session history (database with conversation turns) coexist.

The pattern is most critical when:
- An agent has just recovered from a storage wipe and needs to re-establish continuity
- An agent explicitly creates "channel log" or "session summary" topics in persistent memory
- Persistent memory is growing unbounded across sessions without a corresponding growth in domain knowledge
- Recall results frequently include session-specific noise (sprint outcomes, PR numbers, issue closures)

The pattern does NOT apply to:
- Single-session agents (no continuity problem; both stores effectively reset each time)
- Stateless agents that neither maintain memory nor session history
- Systems where session history IS the persistent store (no separation exists to enforce)

## Solution

Classify every potential storage write into one of three types before saving, and route to the correct storage system:

**Type A — Persistent Knowledge** (use memory): Information that cannot be re-derived by querying session history or an external repository, or that represents a *synthesized summary* maintained across sessions as a living document. Examples: cross-domain synthesis ("distributed systems patterns apply to agent architecture in these ways"), design rationale ("we chose approach X because Y"), project manifests that accumulate cross-session decisions and are not tracked in any external system, cross-session patterns ("every time we try X, Y happens"). User preferences may also be stored here, but apply a sensitivity check: avoid storing preferences that include personal or confidential details unless the system has a defined retention and access policy for that data.

**Type B — Transient State** (use session-store): Information that *can* be re-derived from session history. Examples: raw conversation turns, sprint outcomes ("PR #42 merged, 0 HIGH findings"), checkpoint summaries ("completed step 3 of 5"), session compactions ("this session covered topics A, B, C"). This belongs in the session history database — accessible via SQL queries, full-text search, and structured filtering.

**Type C — Archival** (use external repository): Resolved incidents, shipped features, closed issues, merged PRs. This belongs in the code repository, issue tracker, or incident log — not in the agent's working memory.

**The decision rule before any memory write:**

```
Can I re-derive this by querying session history or an external repository?
  YES → it's session state or archival; do NOT save to persistent memory
  NO  → it's synthesized knowledge; save to persistent memory
```

For session continuity specifically: agents should query the session-store rather than relying on memory topics. For example: `SELECT content FROM turns WHERE session_id = (SELECT id FROM sessions WHERE agent_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1) ORDER BY turn_index DESC LIMIT 20`. Scope the query to the relevant agent and project/channel to avoid pulling turns from unrelated conversations in shared session-stores. If the session-store is empty or unavailable, the correct response is to ask the user for context — not to create a memory topic that encodes what was discussed.

**Pruning heuristic addition**: When reviewing memory for pruning, topic names and content patterns can signal session-log drift into persistent memory — but treat these as triggers for *manual review*, not automatic deletion. Name patterns like `channel-log-*`, `compaction-*`, `session-summary-*`, or slugs containing an ISO date (`-2024-05-13`) warrant inspection. The key question is whether the topic contains a *synthesized analytical claim* (which should stay) or only raw session narrative (which belongs in the session-store). Note that legitimate knowledge topics may also reference PR numbers or dates as evidence — the presence of these alone is not sufficient to prune; look for whether a session-independent claim exists alongside them.

## Evidence

**Post-disaster-recovery incident (production, 2026-06-28):**

After a storage wipe, agents rebuilt continuity by creating persistent memory topics for session logs. Within 3 days:
- Memory grew from 16 → 73 topics (4.6× growth)
- 26 topics (35.6%) were `channel-log-*` or `compaction-*` entries
- Recall noise measured at 2:1 (two noise results per one signal result)
- Memory-gardener (automated pruning) failed to remove them: same-session recall inflated utility scores above the pruning threshold
- Session continuity remained dependent on memory topics even after session-store re-populated — continuity broke when a manual pruning pass removed the logs

**Root cause analysis**: The session-store was empty after the wipe. Agents correctly identified that session continuity was lost, but incorrectly routed the recovery to persistent memory rather than accepting that continuity would rebuild over time via session history.

**Fix applied**: Enforcement of Type-A/B/C routing rules. After 7 days under the new rules:
- Memory topic count stabilized at 22 (no growth from session logs)
- Recall noise ratio dropped below 0.15
- Session continuity preserved via session-store queries; no memory topics for logs

**Analogous patterns in adjacent systems**: LangChain distinguishes `ConversationBufferMemory` (session buffer, discarded after session) from `VectorStore` (persistent retrieval). Database systems distinguish transaction logs (append-only, rolling window) from persistent tables (structured, queryable). Git distinguishes working-tree state from committed history. The two-store separation is a broadly validated architectural principle applied here to agent systems.

## Tradeoffs

**Session continuity cost**: Accepting that session history lives only in the session-store means agents lose continuity when the session-store is unavailable or empty (e.g., after a wipe). The alternative — storing session summaries in persistent memory — preserves continuity at the cost of recall noise. Teams must decide which failure mode is more tolerable. For most systems, a "please remind me of the context" prompt to the user is preferable to permanent recall degradation.

**Re-derivability judgment**: The decision rule requires the agent to judge whether information "can be re-derived." This judgment is imperfect. Design rationale embedded only in a conversation transcript may technically be re-derivable but practically inaccessible (buried in 500 turns, hard to surface). In genuinely ambiguous cases, the preferred resolution is to *extract and synthesize* the rationale into a clearly scoped memory topic (e.g., `project-architecture-decisions`) rather than saving the raw session narrative. The synthesized form should contain only the analytical claim ("we chose X because Y") and a pointer to the source session, not the transcript itself. This keeps the routing rule intact: synthesized knowledge goes to memory, raw transcript stays in the session-store.

**Tooling dependency**: This pattern assumes the session-store is queryable (e.g., FTS5 SQL search). Systems with opaque session histories — where agents cannot query past turns — lose the re-derivability path and may need to use persistent memory more liberally. Investing in a queryable session history store unlocks this pattern fully.

## Related Patterns

- **[Read-Before-Write Memory Guard](/agent-prompt-patterns/patterns/read-before-write-memory-guard)** — prevents accidental overwrites of existing memory topics; this pattern prevents saving to the wrong storage system entirely
- **[Strategic Memory Recall in Autonomous Task Chains](/agent-prompt-patterns/patterns/strategic-memory-recall)** — when to recall; this pattern defines *what* to save
- **[Belief-Entropy Checkpointing](/agent-prompt-patterns/patterns/belief-entropy-checkpointing)** — when to checkpoint task state; checkpoints go to session-store, not persistent memory
