# Core & Desktop Integration Instructions

## Context

> ⚠️ This plugin sends new wire format. Core and desktop must update to consume. See Core Tasks and Desktop Tasks sections.

The OpenCode plugin now sends **v2-enriched data** over the WebSocket wire. This document describes what changed and what core/desktop need to do to consume it.

---

## Wire Changes (What Plugin Now Sends)

### 1. AgentEvent — Now Includes Cost, Tokens & Target Session

**Before:**
```json
{
  "type": "agent",
  "sessionId": "abc123",
  "role": "primary",
  "name": "coder",
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "prompt": "fix the bug"
}
```

**After:**
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

### 2. StatusEvent — Consolidated Tokens Object

**Before:**
```json
{
  "type": "status",
  "sessionId": "abc123",
  "status": "step-finish",
  "tokens": 1500,
  "cost": 0.0045,
  "tokenBreakdown": {
    "input": 800,
    "output": 400,
    "reasoning": 300,
    "cache": { "read": 200, "write": 100 }
  }
}
```

**After:**
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

**TokenBreakdown type:**
```typescript
type TokenBreakdown = {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
};
```

---

### 3. Initial Session State on Connect

When desktop connects via WebSocket, plugin now sends **initial state events** before message history:

1. **AgentEvent** — with real agent/model/provider from v2 Session (no more `'?'`)
2. **StatusEvent** — with session-level cost and token totals
3. **TodoEvent** — current todos
4. Message history events

This gives desktop immediate context without waiting for next step.

---

### 4. Agent Routing Context

When replaying message history, `AgentPart` events now include real agent/model/provider from the parent `AssistantMessage`:

**Before:**
```json
{
  "type": "agent",
  "sessionId": "abc123",
  "role": "primary",
  "name": "coder",
  "model": "?",
  "provider": "?",
  "prompt": ""
}
```

**After:**
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

## Core Tasks (@agentspyglass/core)

### Task 1: Update AgentEvent Interface

**File:** `src/event.definitions.ts`

```typescript
export interface AgentEvent extends Event {
    role: 'primary' | 'subagent';
    name: string;
    model: string;
    provider: string;
    prompt: string;
    // NEW FIELDS
    cost?: number;
    tokens?: number;
    targetSessionId?: string;
}
```

### Task 2: Update StatusEvent Interface

**File:** `src/event.definitions.ts`

```typescript
export interface StatusEvent extends Event {
    status: 'step-start' | 'reasoning' | 'step-finish';
    cost?: number;
    // CHANGED: tokens is now TokenBreakdown object
    tokens?: TokenBreakdown;
}
```

### Task 3: Add TokenBreakdown Type

**File:** `src/model.definitions.ts` (or `src/event.definitions.ts`)

```typescript
export type TokenBreakdown = {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
};
```

Export from `src/index.ts`.

### Task 4: Update Agent Model Type

**File:** `src/model.definitions.ts`

```typescript
export type Agent = {
    sessionId: string;
    role: 'primary' | 'subagent';
    name: string;
    prompt: string;
    model: string;
    provider: string;
    brand: Brand;
    status?: 'reasoning' | 'completed';
    // NEW FIELDS
    cost?: number;
    tokens?: number;
};
```

---

## Desktop Tasks (agentspyglass Tauri app)

### Task 1: Display Per-Agent Cost

When receiving `AgentEvent`:
- Extract `cost` and `tokens` fields
- Display in agent card/UI
- Accumulate if multiple agents in same session
- Use `targetSessionId` for subagent routing visualization

**Example (Rust/Tauri):**
```rust
#[derive(Deserialize)]
struct AgentEvent {
    #[serde(rename = "type")]
    event_type: String,
    session_id: String,
    role: String,
    name: String,
    model: String,
    provider: String,
    prompt: String,
    cost: Option<f64>,
    tokens: Option<u64>,
    target_session_id: Option<String>,
}

fn handle_agent_event(event: AgentEvent) {
    if let Some(cost) = event.cost {
        update_agent_cost(&event.session_id, &event.name, cost);
    }
    if let Some(tokens) = event.tokens {
        update_agent_tokens(&event.session_id, &event.name, tokens);
    }
    if let Some(parent_id) = &event.target_session_id {
        // Subagent: draw arrow from parent to this agent
        draw_agent_routing(parent_id, &event.session_id);
    }
}
```

### Task 2: Display Token Breakdown

When receiving `StatusEvent` with `tokens`:
- Show detailed breakdown in UI (input/output/reasoning/cache/total)
- Accumulate per session or per agent

**Example (Rust/Tauri):**
```rust
#[derive(Deserialize)]
struct TokenBreakdown {
    total: u64,
    input: u64,
    output: u64,
    reasoning: u64,
    cache: CacheBreakdown,
}

#[derive(Deserialize)]
struct CacheBreakdown {
    read: u64,
    write: u64,
}

#[derive(Deserialize)]
struct StatusEvent {
    #[serde(rename = "type")]
    event_type: String,
    session_id: String,
    status: String,
    cost: Option<f64>,
    tokens: Option<TokenBreakdown>,
}

fn handle_status_event(event: StatusEvent) {
    if let Some(tokens) = &event.tokens {
        show_token_breakdown(
            &event.session_id,
            tokens.total,
            tokens.input,
            tokens.output,
            tokens.reasoning,
            tokens.cache.read,
            tokens.cache.write,
        );
    }
}
```

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

**Example:**
```rust
if event.model != "?" && event.provider != "?" {
    show_agent_badge(&event.name, &event.model, &event.provider);
}
if let Some(parent_id) = &event.target_session_id {
    // This is a subagent - draw routing arrow
    draw_subagent_arrow(parent_id, &event.session_id, &event.name);
}
```

### Task 5: Accumulate Session Totals

Track cumulative cost/tokens per session:
- On each `StatusEvent` with `cost`/`tokens` → add to session total
- On each `AgentEvent` with `cost`/`tokens` → initialize or update agent total
- Display session-level and agent-level totals separately

**Example:**
```rust
struct SessionStats {
    total_cost: f64,
    total_tokens: u64,
    agent_costs: HashMap<String, f64>,
    agent_tokens: HashMap<String, u64>,
}

fn update_session_stats(stats: &mut SessionStats, event: &StatusEvent) {
    if let Some(cost) = event.cost {
        stats.total_cost += cost;
    }
    if let Some(tokens) = &event.tokens {
        stats.total_tokens += tokens.total;
    }
}
```

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

All new fields are **optional** (`?` in TypeScript, `Option<T>` in Rust).

If desktop receives old events without these fields:
- `cost` → `None` / `undefined`
- `tokens` → `None` / `undefined`
- `targetSessionId` → `None` / `undefined`

Desktop should handle missing fields gracefully (show 0 or hide UI element).

**Important:** The `tokens` field changed from `number` to `TokenBreakdown` object. Desktop must handle both formats during transition:
```rust
// Handle old format (number) and new format (TokenBreakdown)
match &event.tokens {
    TokensEnum::Number(n) => { /* old format */ },
    TokensEnum::Object(breakdown) => { /* new format with total, input, output, etc. */ },
}
```

---

## Wire Format Reference

### AgentEvent (full)

```typescript
interface AgentEvent {
    type: 'agent';
    sessionId: string;
    role: 'primary' | 'subagent';
    name: string;
    model: string;
    provider: string;
    prompt: string;
    cost?: number;
    tokens?: number;
    targetSessionId?: string;  // NEW: parent session for subagents
}
```

### StatusEvent (full)

```typescript
interface StatusEvent {
    type: 'status';
    sessionId: string;
    status: 'step-start' | 'reasoning' | 'step-finish';
    cost?: number;
    tokens?: {                 // CHANGED: was flat number, now object
        total: number;
        input: number;
        output: number;
        reasoning: number;
        cache: { read: number; write: number };
    };
}
```

---

## Questions?

Refer to `docs/v1-v2-sdk-discovery.md` for full v1/v2 SDK analysis.
