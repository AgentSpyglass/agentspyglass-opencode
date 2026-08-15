import type {Server, ServerWebSocket} from "bun"
import {Event, AgentEvent, MessageEvent, StatusEvent, ToolEvent, TodoEvent} from "@agentspyglass/core"
import type {Part} from "@opencode-ai/sdk"
import { PluginInput } from "@opencode-ai/plugin"
import {StepFinishPart} from "@opencode-ai/sdk/v2";
import type {Session, AssistantMessage} from "@opencode-ai/sdk/v2/types";
import { findSession } from "./util/opencode.util";

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
        // Fetch session with v2-enriched data (cost, tokens, agent, model)
        const session = await findSession(sessionId, plugin);

        // Send initial AgentEvent with real agent/model/provider from v2 Session
        if (session.agent || session.model) {
            const totalTokens = session.tokens
                ? session.tokens.input + session.tokens.output + session.tokens.reasoning
                : 0;
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'agent',
                    sessionId,
                    name: session.agent ?? '',
                    model: session.model?.id ?? '',
                    provider: session.model?.providerID ?? '',
                    prompt: '',
                    role: session.parentID ? 'subagent' : 'primary',
                    cost: session.cost ?? 0,
                    tokens: totalTokens,
                } as AgentEvent));
            }
        }

        // Send initial StatusEvent with session-level cost and token totals
        if ((session.cost !== undefined && session.cost > 0) || session.tokens) {
            const totalTokens = session.tokens
                ? session.tokens.input + session.tokens.output + session.tokens.reasoning
                : undefined;
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'status',
                    sessionId,
                    status: 'step-finish' as const,
                    tokens: totalTokens,
                    cost: session.cost,
                    tokenBreakdown: session.tokens ? {
                        input: session.tokens.input,
                        output: session.tokens.output,
                        reasoning: session.tokens.reasoning,
                        cache: session.tokens.cache,
                    } : undefined,
                } as StatusEvent));
            }
        }

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
            // Extract agent/model context from AssistantMessage wrapper
            const msgInfo = message.info as any;
            const messageContext = msgInfo?.role === 'assistant'
                ? {
                    agent: msgInfo.agent as string | undefined,
                    modelID: msgInfo.modelID as string | undefined,
                    providerID: msgInfo.providerID as string | undefined,
                }
                : undefined;

            for (const part of message.parts) {
                const event = convertPartToEvent(part, messageContext);
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

function convertPartToEvent(
    part: Part,
    messageContext?: { agent?: string; modelID?: string; providerID?: string }
): AgentEvent | MessageEvent | StatusEvent | ToolEvent | null {
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
            let tokenBreakdown: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } | undefined;
            if (part.type === 'step-finish') {
                tokens = (part as StepFinishPart).tokens.total;
                cost = part.cost;
                tokenBreakdown = {
                    input: (part as StepFinishPart).tokens.input,
                    output: (part as StepFinishPart).tokens.output,
                    reasoning: (part as StepFinishPart).tokens.reasoning,
                    cache: (part as StepFinishPart).tokens.cache,
                };
            }
            return {
                type: 'status',
                sessionId: part.sessionID,
                status: part.type,
                tokens,
                cost,
                tokenBreakdown,
            } as StatusEvent;
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
            // Use parent message's agent/model if available, else fallback
            return {
                type: 'agent',
                sessionId: part.sessionID,
                role: 'primary',
                name: messageContext?.agent ?? part.name,
                model: messageContext?.modelID ?? '?',
                provider: messageContext?.providerID ?? '?',
                prompt: ''
            };

        default:
            // subtask, file, snapshot, patch, retry, compaction — skip
            return null;
    }
}
