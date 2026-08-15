# Core & Desktop Integration Instructions

## Context

The OpenCode plugin now sends **v2-enriched data** over the WebSocket wire. This document describes what changed and what core/desktop need to do to consume it.

---

## Wire Changes (What Plugin Now Sends)

### 1. AgentEvent — Now Includes Cost & Tokens

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
  "tokens": 1500
}
```

**New fields:**
- `cost?: number` — session cost at agent creation time (from v2 Session.cost)
- `tokens?: number` — total tokens at agent creation time (sum of input+output+reasoning)

---

### 2. StatusEvent — Now Includes Token Breakdown

**Before:**
```json
{
  "type": "status",
  "sessionId": "abc123",
  "status": "step-finish",
  "tokens": 1500,
  "cost": 0.0045
}
```

**After:**
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

**New field:**
- `tokenBreakdown?: TokenBreakdown` — full token breakdown per step

**TokenBreakdown type:**
```typescript
type TokenBreakdown = {
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
}
```

### Task 2: Update StatusEvent Interface

**File:** `src/event.definitions.ts`

```typescript
export interface StatusEvent extends Event {
    status: 'step-start' | 'reasoning' | 'step-finish';
    tokens?: number;
    cost?: number;
    // NEW FIELD
    tokenBreakdown?: TokenBreakdown;
}
```

### Task 3: Add TokenBreakdown Type

**File:** `src/model.definitions.ts` (or `src/event.definitions.ts`)

```typescript
export type TokenBreakdown = {
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
    provider: string;  // NEW — was missing
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
}

fn handle_agent_event(event: AgentEvent) {
    if let Some(cost) = event.cost {
        // Update agent card with cost
        update_agent_cost(&event.session_id, &event.name, cost);
    }
    if let Some(tokens) = event.tokens {
        // Update agent card with token count
        update_agent_tokens(&event.session_id, &event.name, tokens);
    }
}
```

### Task 2: Display Token Breakdown

When receiving `StatusEvent` with `tokenBreakdown`:
- Show detailed breakdown in UI (input/output/reasoning/cache)
- Accumulate per session or per agent

**Example (Rust/Tauri):**
```rust
#[derive(Deserialize)]
struct TokenBreakdown {
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
    tokens: Option<u64>,
    cost: Option<f64>,
    token_breakdown: Option<TokenBreakdown>,
}

fn handle_status_event(event: StatusEvent) {
    if let Some(breakdown) = event.token_breakdown {
        // Show detailed breakdown
        show_token_breakdown(
            &event.session_id,
            breakdown.input,
            breakdown.output,
            breakdown.reasoning,
            breakdown.cache.read,
            breakdown.cache.write,
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

With real agent/model/provider in `AgentPart` events:
- Desktop can now show which agent produced each message
- Draw arrows: Agent A → Agent B (when subtask spawned)
- Label messages with agent name

**Example:**
```rust
// When receiving AgentEvent with real model/provider
if event.model != "?" && event.provider != "?" {
    // Show agent badge with model info
    show_agent_badge(&event.name, &event.model, &event.provider);
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
    if let Some(tokens) = event.tokens {
        stats.total_tokens += tokens;
    }
}
```

---

## Testing Checklist

After implementing core/desktop changes:

- [ ] Desktop receives `AgentEvent` with `cost` and `tokens` fields
- [ ] Desktop receives `StatusEvent` with `tokenBreakdown` field
- [ ] Initial session state shows correct cost/totals on connect
- [ ] Agent cards display real model/provider (not `'?'`)
- [ ] Token breakdown UI shows input/output/reasoning/cache
- [ ] Session-level cost accumulates correctly
- [ ] Per-agent cost accumulates correctly
- [ ] Routing visualization works (agent A → agent B)

---

## Backward Compatibility

All new fields are **optional** (`?` in TypeScript, `Option<T>` in Rust).

If desktop receives old events without these fields:
- `cost` → `None` / `undefined`
- `tokens` → `None` / `undefined`
- `tokenBreakdown` → `None` / `undefined`

Desktop should handle missing fields gracefully (show 0 or hide UI element).

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
    cost?: number;           // NEW
    tokens?: number;         // NEW
}
```

### StatusEvent (full)

```typescript
interface StatusEvent {
    type: 'status';
    sessionId: string;
    status: 'step-start' | 'reasoning' | 'step-finish';
    tokens?: number;
    cost?: number;
    tokenBreakdown?: {       // NEW
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
