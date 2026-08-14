import type {Server, ServerWebSocket} from "bun"
import {Event, AgentEvent, MessageEvent, StatusEvent, ToolEvent, TodoEvent} from "@agentspyglass/core"
import type {Part} from "@opencode-ai/sdk"
import { PluginInput } from "@opencode-ai/plugin"

const PORT = Number(process.env.AGENTSPYGLASS_PORT ?? 51763)
const HOST = "127.0.0.1"

let server: Server<any> | undefined
let currentSessionId: string | undefined
const clients = new Set<ServerWebSocket<unknown>>()

export async function startBridge(plugin: PluginInput, sessionId: string) {
    currentSessionId = sessionId;
    if (server) return;

    server = Bun.serve({
        hostname: HOST,
        port: PORT,
        fetch: (request) => {
            if (server?.upgrade(request)) return;
            return new Response("AgentSpyglass bridge is running", {status: 200});
        },
        websocket: {
            async open(ws) {
                clients.add(ws);
                try {
                    await populateClient(ws, plugin);
                } catch (error) {
                    plugin.client.tui.showToast({
                        body: {
                            message: `AgentSpyglass failed to load history: ${error}`,
                            variant: 'error'
                        }
                    });
                }
            },
            close(ws) {
                clients.delete(ws);
            },
            message() {}
        },
    });
}

export function broadcastEvent(event: Event) {
    for (const ws of clients) {
        try {
            ws.send(JSON.stringify(event));
        } catch {
            clients.delete(ws);
        }
    }
}

export function stopBridge() {
    for (const ws of clients) {
        try {
            ws.close();
        } catch {}
    }
    clients.clear();
    server?.stop();
    server = undefined;
}

// TODO: send todo event to specific ws, not broadcast
async function populateClient(ws: ServerWebSocket, plugin: PluginInput) {
    const sessionId = currentSessionId;
    if (!sessionId) return;

    try {
        // fetch todos and send to specific client
        const {data: todos} = await plugin.client.session.todo({
            path: { id: sessionId }
        });
        if (todos && ws.readyState === 1) {
            ws.send(JSON.stringify({
                type: 'todo',
                sessionId,
                todos: todos.map(t => ({
                    content: t.content,
                    priority: t.priority as 'high' | 'medium' | 'low',
                    status: t.status as 'pending' | 'in_progress' | 'completed' | 'cancelled'
                }))
            } satisfies TodoEvent));
        }

        // fetch all messages, convert parts, send to specific client
        const {data: messages} = await plugin.client.session.messages({
            path: { id: sessionId }
        });
        if (!messages) return;

        for (const message of messages) {
            for (const part of message.parts) {
                const event = convertPartToEvent(part);
                if (event && ws.readyState === 1) {
                    ws.send(JSON.stringify(event));
                }
            }
        }
    } catch (error) {
        clients.delete(ws);
        throw error;
    }
}

function convertPartToEvent(part: Part): AgentEvent | MessageEvent | StatusEvent | ToolEvent | null {
    switch (part.type) {
        case 'text':
            return {
                type: 'message',
                sessionId: part.sessionID,
                content: part.text
            };

        case 'step-start':
        case 'reasoning':
        case 'step-finish': {
            let tokens: number | undefined;
            let cost: number | undefined;
            if (part.type === 'step-finish') {
                // v1 StepFinishPart has {input, output, reasoning, cache} - compute total
                tokens = part.tokens.input + part.tokens.output + part.tokens.reasoning;
                cost = part.cost;
            }
            return {
                type: 'status',
                sessionId: part.sessionID,
                status: part.type,
                tokens,
                cost
            };
        }

        case 'tool': {
            const state = part.state;
            let status: 'running' | 'completed' = 'completed';
            let input: any = undefined;

            if (state.status === 'running' || state.status === 'pending') {
                status = 'running';
                input = state.input;
            } else if (state.status === 'completed') {
                status = 'completed';
                input = state.input;
            } else if (state.status === 'error') {
                // ToolEvent only has running|completed, map error to completed with error info
                status = 'completed';
                input = { ...state.input, _error: state.error };
            }

            return {
                type: 'tool',
                sessionId: part.sessionID,
                callId: part.callID,
                name: part.tool,
                input,
                status
            };
        }

        case 'agent':
            // AgentPart only has name, model/provider/prompt data not available
            return {
                type: 'agent',
                sessionId: part.sessionID,
                role: 'primary',
                name: part.name,
                model: '?',
                provider: '?',
                prompt: ''
            };

        default:
            // subtask, file, snapshot, patch, retry, compaction — skip
            return null;
    }
}
