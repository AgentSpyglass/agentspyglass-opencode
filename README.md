# @agentspyglass/opencode

OpenCode plugin that bridges session and tool events to an AgentSpyglass desktop window via WebSocket.

## Usage

```bash
npm install
AGENTSPYGLASS_DEV=1 opencode plugin $(pwd) && opencode
```

Then in OpenCode: `/spyglass` to start, `/spyglass off` to stop.
