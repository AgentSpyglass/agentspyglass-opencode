# @agentspyglass/opencode

## What

OpenCode plugin that bridges session/tool events to an AgentSpyglass desktop window via WebSocket.

## Architecture

```
src/
  index.ts          Plugin entry. Hooks OpenCode events.
  server.ts         Bun WebSocket server. Broadcasts events to desktop.
  window.ts         Spawns/kills the Tauri desktop window.
  download.ts       Downloads + caches desktop app from GitHub releases.
  command/spyglass.ts   /spyglass command handler.
  handler/event.handler.ts  Converts OpenCode events → wire types → broadcast.
  holder/session-storage.service.ts  In-memory session tracker.
  util/opencode.util.ts      Session lookup helper.
```

## Key Dependencies

- `@agentspyglass/core` — wire event types (source-only, `file:../agentspyglass-core`)
- `@opencode-ai/plugin` — plugin API
- `@opencode-ai/sdk` — OpenCode client for session/message history
- Bun runtime

## Rules

- All wire types imported from `@agentspyglass/core`, never defined locally.
- `window.ts` finds the desktop app at `../agentspyglass` (sibling repo).
- WebSocket port: `51763` (env `AGENTSPYGLASS_PORT` to override).
- Dev mode: `AGENTSPYGLASS_DEV=1` runs `npm run tauri dev` in desktop dir.
- Prod mode: `download.ts` fetches latest GitHub release, caches binary in `~/.agentspyglass/{version}/`. Old versions are pruned automatically.

## Commands

- `/spyglass` — start bridge + open window
- `/spyglass off` — stop bridge + kill window
