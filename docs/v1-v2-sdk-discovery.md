# OpenCode SDK v1 vs v2 Discovery

## Overview

The `@opencode-ai/sdk` (v1.18.16) exposes two API surfaces: **v1** (default) and **v2** (subpath export). The plugin's `plugin.client` is a v1 `OpencodeClient`, but the v1 API **returns data matching the v2 shape at runtime**. We cast responses to v2 types to access richer fields.

## Session Type: v1 vs v2

### v1 Session (no cost/tokens/agent/model)

```typescript
// @opencode-ai/sdk (v1)
type Session = {
    id: string;
    projectID: string;
    directory: string;
    parentID?: string;
    summary?: { additions, deletions, files, diffs? };
    share?: { url: string };
    title: string;
    version: string;
    time: { created, updated, compacting? };
    revert?: { messageID, partID?, snapshot?, diff? };
};
```

### v2 Session (rich data)

```typescript
// @opencode-ai/sdk/v2/types
type Session = {
    id: string;
    slug: string;                      // NEW
    projectID: string;
    workspaceID?: string;              // NEW
    directory: string;
    path?: string;                     // NEW
    parentID?: string;
    summary?: { additions, deletions, files, diffs? };
    cost?: number;                     // NEW — total session cost
    tokens?: {                         // NEW — full token breakdown
        input: number;
        output: number;
        reasoning: number;
        cache: { read: number; write: number };
    };
    share?: { url: string };
    title: string;
    agent?: string;                    // NEW — active agent name
    model?: {                          // NEW — model reference
        id: string;
        providerID: string;
        variant?: string;
    };
    version: string;
    metadata?: { [key: string]: unknown };  // NEW
    time: { created, updated, compacting?, archived? };
    permission?: PermissionRuleset;    // NEW
    revert?: { messageID, partID?, snapshot?, diff? };
};
```

## Message Type: v1 vs v2

### v1 AssistantMessage (no agent field)

```typescript
type AssistantMessage = {
    id, sessionID, role: "assistant", time: {...};
    parentID: string;
    modelID: string;
    providerID: string;
    mode: string;                      // NOT agent name
    cost: number;
    tokens: { input, output, reasoning, cache: { read, write } };
    // ... no agent field
};
```

### v2 AssistantMessage (has agent field)

```typescript
type AssistantMessage = {
    id, sessionID, role: "assistant", time: {...};
    agent: string;                     // NEW — which agent produced this
    modelID: string;
    providerID: string;
    variant?: string;                  // NEW
    cost: number;
    tokens: {
        total?: number;                // NEW — optional total
        input, output, reasoning: number;
        cache: { read, write };
    };
    // ...
};
```

### v1 UserMessage (has agent field)

```typescript
type UserMessage = {
    id, sessionID, role: "user", time: {...};
    agent: string;                     // EXISTS in v1 (user only)
    model: { providerID, modelID };
    // ...
};
```

## StepFinishPart (v2)

```typescript
type StepFinishPart = {
    id, sessionID, messageID, type: "step-finish";
    reason: string;
    snapshot?: string;
    cost: number;
    tokens: {
        total?: number;                // optional total
        input, output, reasoning: number;
        cache: { read, write };
    };
};
```

## API Client Differences

### v1 OpencodeClient (plugin.client)

- Uses path-based parameters: `{ path: { id } }`
- `session.get({ path: { id } })` → returns v1-shaped Session (but runtime has v2 data)
- `session.messages({ path: { id } })` → returns `Array<{ info: Message, parts: Part[] }>`
- `session.todo({ path: { id } })` → returns todos

### v2 OpencodeClient (NOT accessible from plugin.client)

- Uses flat parameters: `{ sessionID }`
- Much larger API surface: `v2.session.list()`, `v2.session.history()`, `v2.session.events()` (SSE), etc.
- `v2.agent.list()`, `v2.model.list()`, `v2.provider.list()`
- Rich routing events: `session.next.agent.switched`, `session.next.step.started`

## Casting Pattern

Since `plugin.client` is v1 but returns v2-shaped data:

```typescript
import type { Session } from "@opencode-ai/sdk/v2/types";

const response = await plugin.client.session.get({ path: { id } });
const session = response.data as unknown as Session;
// Now session.cost, session.tokens, session.agent, session.model are accessible
```

## Message Routing

### Available in v2

| Signal | Source | What it tells you |
|--------|--------|-------------------|
| `AssistantMessage.agent` | v2 types | Which agent produced this message |
| `session.next.agent.switched` | v2 SSE events | When agent changes mid-session |
| `session.next.step.started` | v2 SSE events | Every step declares `{agent, model}` |
| `SubtaskPart.agent` | v1+v2 types | Which agent/model was delegated to |
| `Session.parentID` | v1+v2 types | Child→parent session link |

### Not available in v1

- `AssistantMessage.agent` — v1 only has `mode: string`
- Routing SSE events — v2-only API surface

## Wire Type Extensions (opencode → desktop)

Extra fields sent over WebSocket (not yet in `@agentspyglass/core` types):

| Event | Extra Field | Type | Purpose |
|-------|-------------|------|---------|
| `AgentEvent` | `cost` | `number` | Session cost at agent creation time |
| `AgentEvent` | `tokens` | `number` | Total tokens at agent creation time |
| `StatusEvent` | `tokenBreakdown` | `{input, output, reasoning, cache}` | Full token breakdown per step |

These are JSON-serialized and sent over the wire. The desktop consumer can read them. Future `@agentspyglass/core` update should add these to the type definitions.

## SDK Subpath Exports

| Import Path | What |
|-------------|------|
| `@opencode-ai/sdk` | v1 client + types |
| `@opencode-ai/sdk/client` | v1 client only |
| `@opencode-ai/sdk/v2` | v2 client + types + data |
| `@opencode-ai/sdk/v2/client` | v2 client only |
| `@opencode-ai/sdk/v2/types` | v2 generated types only |

## Key Takeaways

1. **v1 API returns v2 data** — cast to v2 types to access cost/tokens/agent/model
2. **No v2 client from plugin** — `plugin.client` is v1 only; v2 client requires separate initialization
3. **Agent routing** — v2 `AssistantMessage.agent` is the key field; v1 lacks it on assistant messages
4. **Token breakdown** — v2 `StepFinishPart.tokens` has full `{input, output, reasoning, cache}` breakdown
5. **Session accumulation** — `SessionHold` now tracks cumulative cost/tokens from v2 data
6. **Wire extensions** — extra fields sent via JSON, core types need future update
