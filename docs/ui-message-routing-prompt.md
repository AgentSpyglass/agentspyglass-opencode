# Message Routing Implementation Prompt

## Context

@agentspyglass/opencode plugin now sends MessageEvent with routing fields. Desktop UI must handle and display from/to message tracking.

## Wire Type Changes

### MessageEvent (from @agentspyglass/core)

```typescript
export interface MessageEvent extends Event {
    content: string;
    role: 'user' | 'assistant';  // NEW: who sent this message
    messageID: string;            // NEW: unique message identifier
    parentID?: string;            // NEW: parent message ID (assistant → user link)
}
```

### Event Base

```typescript
export interface Event {
    type: string;      // 'message' for MessageEvent
    sessionId: string; // which session this message belongs to
}
```

## What Desktop Receives

Every MessageEvent now includes:

- `role` — `'user'` (human input) or `'assistant'` (AI response)
- `messageID` — unique ID for this message
- `parentID` — if role='assistant', this is the messageID of the user message it responds to

## Required UI Changes

### 1. Message Display

Show role indicator for each message:
- User messages: label/icon "User" or 👤
- Assistant messages: label/icon "Assistant" or 🤖

### 2. Reply Threading (Optional but Recommended)

Use `parentID` to show conversation flow:
- Assistant messages can show "Replying to: [user message preview]"
- Click parentID link → scroll to/highlight parent message
- Visual indentation or connector lines for reply chains

### 3. Message Identification

Use `messageID` for:
- React list keys (unique identifier per message)
- Deep linking (URL hash or route param)
- Message selection/copy/share features

### 4. Session Filtering

Messages already filtered by `sessionId`. No change needed, but routing fields enable:
- "Show only my messages" filter (role='user')
- "Show only AI responses" filter (role='assistant')
- "Show conversation thread" view (follow parentID chain)

## Data Flow

```
OpenCode → Plugin → WebSocket → Desktop
                                  ↓
                          MessageEvent {
                            type: 'message',
                            sessionId: 'ses_xxx',
                            content: 'Hello',
                            role: 'user',
                            messageID: 'msg_abc',
                            parentID: undefined
                          }
```

Assistant reply:
```
MessageEvent {
  type: 'message',
  sessionId: 'ses_xxx',
  content: 'Hi there!',
  role: 'assistant',
  messageID: 'msg_def',
  parentID: 'msg_abc'  // ← links to user message
}
```

## Implementation Notes

- `parentID` is optional — user messages have no parent
- `messageID` is always present (string)
- `role` is always present ('user' | 'assistant')
- Messages arrive in chronological order
- Same `messageID` may appear in multiple events if message updates (streaming)

## Example UI Component (Pseudo-code)

```typescript
function MessageBubble({ event }: { event: MessageEvent }) {
    const isUser = event.role === 'user';
    
    return (
        <div className={isUser ? 'user-message' : 'assistant-message'}>
            <div className="message-header">
                <span>{isUser ? '👤 You' : '🤖 Assistant'}</span>
                {event.parentID && (
                    <a href={`#msg-${event.parentID}`}>
                        ↩ Reply to message
                    </a>
                )}
            </div>
            <div className="message-content">{event.content}</div>
        </div>
    );
}
```

## Testing

Verify:
1. User messages show role='user', no parentID
2. Assistant messages show role='assistant', parentID points to user message
3. messageID unique per message
4. Reply links work (scroll to parent)
5. Streaming updates preserve messageID (same ID, content grows)

## Dependencies

- @agentspyglass/core PR #7 merged (MessageEvent interface)
- @agentspyglass/opencode PR #8 merged (plugin sends routing fields)

## Desktop App Location

UI implementation goes in: `/home/vitor/Documentos/AgentSpyglass/agentspyglass/`

This is the Tauri desktop app that connects to the plugin WebSocket.

## Questions?

Check:
- `/home/vitor/Documentos/AgentSpyglass/agentspyglass-core/src/event.definitions.ts` — wire types
- `/home/vitor/Documentos/AgentSpyglass/agentspyglass-opencode/src/server.ts` — how routing populated
- `/home/vitor/Documentos/AgentSpyglass/agentspyglass-opencode/src/index.ts` — live event handling
- `/home/vitor/Documentos/AgentSpyglass/agentspyglass/` — desktop app (implement UI here)
