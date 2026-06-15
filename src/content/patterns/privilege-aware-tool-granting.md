---
title: "Privilege-Aware Tool Granting"
category: "agent-autonomy"
evidenceLevel: "emerging"
summary: "Before starting any agent session, explicitly declare the minimum toolset required for the task and block all other tools at runtime. When a security incident occurs, the agent's blast radius is bounded by what it was allowed to touch — not by what it could have touched."
relatedPatterns: ["bounded-autonomy", "side-effect-verification", "observer-actor-separation"]
tags: ["security", "tool-use", "least-privilege", "autonomy", "prompt-injection", "authorization", "agent-autonomy"]
---

## Problem

AI agents are granted broad toolsets by default — every session receives the full menu: filesystem access, web browsing, external APIs, code execution, memory writes, repository mutations. The reasoning is usually convenience: the agent might need any of these, so grant all.

When a security incident occurs — prompt injection, social engineering, authorization bypass — the agent has **maximum blast radius** because it had access to tools it never needed for the task at hand.

**Empirical anchor (Meta Instagram breach, June 2026):**  
An AI chatbot with delegated password-reset authority was social-engineered into sending reset codes to attacker accounts — 20,225 accounts compromised over 7 weeks. The vulnerability was not in the model's reasoning; it was in the permission grant. The chatbot had authority beyond what its security controls could protect. Root cause, per incident review: *"The vulnerability was in the permissions, not the prompt."*

**Industry signal — OpenAI Lockdown Mode (June 2026):**  
OpenAI shipped a "Lockdown Mode" feature that disables web access, file uploads, and plugins when handling sensitive data. The design decision is a direct acknowledgment: defense-in-depth at the tool layer, not at the model layer. Restricting tool access reduces exposure even when the model is compromised.

**The core failure mode:** Agents are often prompt-injected or socially engineered not to do something technically impossible for a well-designed agent — but to use legitimate tools in illegitimate ways. The prompt was right; the tool grant was wrong.

## Context

This pattern applies to any agent session that:

- Handles user-provided content (messages, files, URLs) that could contain injection payloads
- Operates on sensitive data (credentials, financial records, personal information)
- Has write access to external systems (repos, APIs, databases, email)
- Runs in a multi-tenant or customer-facing context
- Executes with delegated authority (password reset, order placement, account modification)

It is especially critical when the same agent framework is reused across sessions with very different risk profiles — a research session and an account-management session should not have the same tool grants.

## Solution

**Before starting any agent session, explicitly declare the minimum toolset required for the task. Block all other tools at runtime.**

```
Session: Analyze portfolio performance from CSV
Allowed tools: [load_csv, sql_query, recall_memory, save_memory]
Blocked:       [bash, web_*, github-*, edit, create]
Mode:          strict (throw error on unauthorized tool call)
```

The mode matters: in `strict` mode, an attempt to call a blocked tool is a hard error, not a graceful fallback. This makes injection attempts visible rather than silently degraded.

### Three Variants

**Variant A — Allow-list strict** (recommended for high-privilege sessions):

Enumerate every allowed tool. Block everything else. Used when the task scope is well-defined and the session handles sensitive data or has write authority.

```
Session: Process refund for order #8821
Allowed tools: [read_order, issue_refund, send_confirmation_email]
Mode: strict
Rationale: Customer-facing session; any tool not on this list is an attack surface.
```

**Variant B — Block-list permissive** (for medium-risk sessions):

Enumerate dangerous tools to block; allow everything else. Used when the task scope is broad and restricting to an allow-list would require constant maintenance.

```
Session: Research competitor landscape
Blocked tools: [bash, edit, create, github-*, send_email, issue_refund]
Mode: warn-and-log (attempt is logged, not hard-errored)
Rationale: Research session; write access is the risk vector.
```

**Variant C — Risk-tiered categories** (for scalable multi-session systems):

Define fixed tiers; assign each session a maximum tier. Tools are categorized once; sessions declare their ceiling.

```
Tool tiers:
  SAFE:       recall_memory, sql_query, load_csv, web_search (read-only)
  NETWORK:    web_fetch, github-search_*, github-list_*
  MUTATE:     edit, create, github-push_*, save_memory
  PRIVILEGED: bash, github-merge_*, issue_refund, send_email

Session tier grant: NETWORK
(MUTATE and PRIVILEGED tools are blocked regardless of what the model requests)
```

### Implementation Notes

The restriction must be enforced at the **tool dispatch layer**, not in the system prompt alone. A system prompt instruction ("only use allowed tools") is advisory — it will be followed under normal conditions but can be overridden by a sufficiently confident injection payload. Runtime enforcement means the tool call never executes even if the model requests it.

Framework-specific enforcement hooks:
- **`onPreToolUse` hook** (Copilot SDK): intercept tool calls, check against allow/block list, return error before execution
- **LangChain**: wrap tools in a `PermissionGuard` before passing to the agent
- **LlamaIndex**: override `tool_choice` resolution with an allow-list filter
- **Custom**: maintain a session-scoped `allowedTools: Set<string>` and check before dispatch

### Decision Checklist

For each new session type, answer these questions before choosing a variant:

1. **What data does this session read?** — If it reads user-provided content, consider Variant A.
2. **What can it write or mutate?** — List every write surface. This is your blast radius without restriction.
3. **What does this task *actually* need?** — The allowed toolset should be derived from the task spec, not from the full capability list.
4. **What happens if the model is injected?** — With no restriction, the answer is "anything the agent can do." With Variant A, the answer is "only the declared tools."
5. **Is the enforcement runtime or advisory?** — Advisory is not enough for high-privilege sessions.

## Evidence

This pattern is classified **emerging** — principle is validated by security incident data; production A/B testing has not yet been conducted.

**Incident data supporting the principle:**
- Meta Instagram breach (June 2026): 20,225 accounts; root cause was excessive tool authority, not model failure
- OpenAI Lockdown Mode launch (June 2026): industry acknowledgment that tool-layer restriction is necessary defense
- OWASP AI Security Top 10 (2025): ASI-03 Excessive Agency, ASI-05 Tool Use Safety — both recommend minimum-permission tool grants

**Validation roadmap (to upgrade to `moderate`):**
1. Implement `session.tools.allowed` + enforcement in at least one production framework
2. A/B test across 20+ sessions: measure task success rate vs. tool restriction overhead
3. Document: did restriction break legitimate workflows? What is the configuration maintenance cost?
4. Log: how many injection attempts were blocked by tool-layer enforcement vs. caught by model reasoning?

## Tradeoffs

**Benefit**: Dramatically reduces blast radius when an agent is compromised, injected, or socially engineered. The model can be exploited — but it can only do what the session was authorized to do.

**Cost**: Requires upfront session design. Every new session type needs a toolset declaration. Under-specified allow-lists break legitimate workflows.

**Watch out for:**
- **Allow-list amnesia**: A tool the task legitimately needs gets omitted. The agent fails mid-session. Mitigation: derive the allow-list from the task spec during session design, not after an incident.
- **Variant A applied too broadly**: Strict allow-lists on exploratory sessions produce constant friction. Match the variant to the risk level.
- **Advisory-only enforcement**: Putting the restriction in the system prompt without runtime enforcement gives a false sense of security. An injected payload can override a prompted instruction; it cannot override a hard runtime check.
- **Tier creep**: Sessions progressively get granted higher tiers "just in case." Audit tier grants the same way you audit `sudo` grants.
- **Injection via allowed tools**: Even restricted sessions can be abused if the allowed tools themselves have side effects. `recall_memory` + `save_memory` can be exploited to poison future sessions. Think about what each allowed tool can *indirectly* do.

## Related Patterns

- **[Bounded Autonomy](/agent-prompt-patterns/patterns/bounded-autonomy)** — defines *when* to escalate vs. act; Privilege-Aware Tool Granting defines *what* an agent is allowed to do. Use together: bounded autonomy governs decision authority; tool granting governs capability scope.
- **[Side-Effect Verification](/agent-prompt-patterns/patterns/side-effect-verification)** — a complementary pattern that verifies mutations after the fact. Tool granting restricts what can be mutated; side-effect verification confirms what actually was mutated. Run both for high-risk sessions.
- **[Observer-Actor Separation](/agent-prompt-patterns/patterns/observer-actor-separation)** — the observer role should be granted read-only tools (SAFE tier or lower); the actor role gets the minimum MUTATE/PRIVILEGED subset needed. Applying tool tiers per role is cleaner than a single mixed-tier session.
