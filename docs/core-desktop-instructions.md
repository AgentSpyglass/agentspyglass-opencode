# Desktop Integration Instructions

> **Note:** Core types updated in PR #5. This document covers desktop consumer changes only.

## Context

The OpenCode plugin now sends **v2-enriched data** over the WebSocket wire. This document describes what desktop needs to do to consume the new format.

---

## Wire Format Reference

### AgentEvent

```typescript
interface AgentEvent {
    type: 'agent';
    sessionId: string;
    role: 'primary' | 'subagent';
    name: string;
    model: string;
    provider: string;
    prompt: string;
    cost?: number;              // session cost at agent creation time
    tokens?: number;            // total tokens at agent creation time
    targetSessionId?: string;   // parent session ID for subagents
}
```

**Example payload:**
```json
{
  "type": "agent",
  "sessionId": "abc123",
  "role": "primary",
  "name": "coder",
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "prompt": "fix the bug",
  "cost": 0.0045,
  "tokens": 1500,
  "targetSessionId": "parent-session-id"
}
```

**New fields:**
- `cost?: number` — session cost at agent creation time (from v2 Session.cost)
- `tokens?: number` — total tokens at agent creation time (sum of input+output+reasoning)
- `targetSessionId?: string` — parent session ID for subagents (undefined for primary)

---

### StatusEvent

```typescript
interface StatusEvent {
    type: 'status';
    sessionId: string;
    status: 'step-start' | 'reasoning' | 'step-finish';
    cost?: number;
    tokens?: TokenBreakdown;    // consolidated token breakdown object
}

type TokenBreakdown = {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
};
```

**Example payload:**
```json
{
  "type": "status",
  "sessionId": "abc123",
  "status": "step-finish",
  "cost": 0.0045,
  "tokens": {
    "total": 1500,
    "input": 800,
    "output": 400,
    "reasoning": 300,
    "cache": { "read": 200, "write": 100 }
  }
}
```

**Changes:**
- `tokens` is now a `TokenBreakdown` object (was flat `number`)
- `tokenBreakdown` field removed — merged into `tokens`
- `tokens.total` contains the total token count

---

### Initial Session State on Connect

When desktop connects via WebSocket, plugin now sends **initial state events** before message history:

1. **AgentEvent** — with real agent/model/provider from v2 Session (no more `'?'`)
2. **StatusEvent** — with session-level cost and token totals
3. **TodoEvent** — current todos
4. Message history events

This gives desktop immediate context without waiting for next step.

---

### Agent Routing Context

When replaying message history, `AgentPart` events now include real agent/model/provider from the parent `AssistantMessage`:

```json
{
  "type": "agent",
  "sessionId": "abc123",
  "role": "primary",
  "name": "coder",
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "prompt": ""
}
```

---

## Desktop Tasks

### Task 1: Display Per-Agent Cost

When receiving `AgentEvent`:
- Extract `cost` and `tokens` fields
- Display in agent card/UI
- Accumulate if multiple agents in same session
- Use `targetSessionId` for subagent routing visualization

### Task 2: Display Token Breakdown

When receiving `StatusEvent` with `tokens`:
- Show detailed breakdown in UI (input/output/reasoning/cache/total)
- Accumulate per session or per agent

### Task 3: Handle Initial Session State

On WebSocket connect, desktop receives:
1. `AgentEvent` (initial session state)
2. `StatusEvent` (session-level cost/totals)
3. `TodoEvent` (current todos)
4. Message history events

**Action:**
- Use initial `AgentEvent` to populate agent card immediately
- Use initial `StatusEvent` to show session cost/totals before any new steps
- No need to wait for first `step-finish` to show cost

### Task 4: Agent Routing Visualization

With real agent/model/provider in `AgentPart` events and `targetSessionId`:
- Desktop can now show which agent produced each message
- Draw arrows: Agent A → Agent B (when subtask spawned)
- Label messages with agent name
- Use `targetSessionId` to link subagents to their parent

### Task 5: Accumulate Session Totals

Track cumulative cost/tokens per session:
- On each `StatusEvent` with `cost`/`tokens` → add to session total
- On each `AgentEvent` with `cost`/`tokens` → initialize or update agent total
- Display session-level and agent-level totals separately

---

## Testing Checklist

After implementing core/desktop changes:

- [ ] Desktop receives `AgentEvent` with `cost`, `tokens`, and `targetSessionId` fields
- [ ] Desktop receives `StatusEvent` with `tokens` as TokenBreakdown object
- [ ] Initial session state shows correct cost/totals on connect
- [ ] Agent cards display real model/provider (not `'?'`)
- [ ] Token breakdown UI shows input/output/reasoning/cache/total
- [ ] Session-level cost accumulates correctly
- [ ] Per-agent cost accumulates correctly
- [ ] Routing visualization works (agent A → agent B via `targetSessionId`)

---

## Backward Compatibility

All new fields are **optional** (`?` in TypeScript).

If desktop receives old events without these fields:
- `cost` → `None` / `undefined`
- `tokens` → `None` / `undefined`
- `targetSessionId` → `None` / `undefined`

Desktop should handle missing fields gracefully (show 0 or hide UI element).