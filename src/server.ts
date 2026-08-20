import type {Server, ServerWebSocket} from "bun"
import {Event, AgentEvent, MessageEvent, StatusEvent, ToolEvent, TodoEvent} from "@agentspyglass/core"
import type {Part} from "@opencode-ai/sdk"
import { PluginInput } from "@opencode-ai/plugin"
import {StepFinishPart} from "@opencode-ai/sdk/v2";
import type {Session, AssistantMessage} from "@opencode-ai/sdk/v2/types";
import {calculateContext, findSession} from "./util/opencode.util";
import type { TokenBreakdown } from "./model/definitions";

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
            const totalTokens = session.tokens ? session.tokens.input + session.tokens.output + session.tokens.reasoning : 0;
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
                    targetSessionId: session.parentID,
                } as AgentEvent & { targetSessionId?: string }));
            }
        }

        // Send initial StatusEvent with session-level cost and token totals
        if ((session.cost !== undefined && session.cost > 0) || session.tokens) {
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'status',
                    sessionId,
                    status: 'step-finish' as const,
                    cost: session.cost,
                    tokens: session.tokens ? {
                        total: session.tokens.input + session.tokens.output + session.tokens.reasoning,
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
            const msgInfo = message.info as any;
            const role = msgInfo?.role as 'user' | 'assistant' | undefined;
            const messageID = msgInfo?.id as string | undefined;
            const parentID = msgInfo?.parentID as string | undefined;

            const messageContext = role === 'assistant'
                ? {
                    agent: msgInfo.agent as string | undefined,
                    modelID: msgInfo.modelID as string | undefined,
                    providerID: msgInfo.providerID as string | undefined,
                }
                : undefined;

            for (const part of message.parts) {
                const event = await convertPartToEvent(part, plugin, messageContext, role, messageID, parentID);
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

async function convertPartToEvent(
    part: Part,
    plugin: PluginInput,
    messageContext?: { agent?: string; modelID?: string; providerID?: string },
    role?: 'user' | 'assistant',
    messageID?: string,
    parentID?: string
): Promise<AgentEvent | MessageEvent | StatusEvent | ToolEvent | null> {
    switch (part.type) {
        case 'text':
            return {
                type: 'message',
                sessionId: part.sessionID,
                content: part.text,
                role: role ?? 'assistant',
                messageID: messageID ?? part.messageID,
                parentID
            };

        case 'step-start':
        case 'reasoning':
        case 'step-finish': {
            let tokens: number | undefined;
            let cost: number | undefined;
            let contextUsed: number | undefined;
            let tokenBreakdown: TokenBreakdown | undefined;
            if (part.type === 'step-finish') {
                const partTokens = (part as StepFinishPart).tokens;
                const total = partTokens.total ?? partTokens.input + partTokens.output + partTokens.reasoning;
                tokens = total;
                cost = part.cost;
                tokenBreakdown = {
                    total,
                    cache: partTokens.cache,
                    input: partTokens.input,
                    output: partTokens.output,
                    reasoning: partTokens.reasoning,
                };
                contextUsed = await calculateContext(part.sessionID, tokens, plugin);
            }
            return {
                type: 'status',
                sessionId: part.sessionID,
                status: part.type,
                cost,
                contextUsed,
                tokens: tokenBreakdown ? {
                    total: tokens ?? tokenBreakdown.total,
                    input: tokenBreakdown.input,
                    output: tokenBreakdown.output,
                    reasoning: tokenBreakdown.reasoning,
                    cache: tokenBreakdown.cache,
                } : (tokens !== undefined ? { total: tokens, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } : undefined),
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

        case 'agent': {
            // Resolve session to get parentID for routing
            const agentSession = plugin ? await findSession(part.sessionID, plugin) : undefined;
            const role = agentSession?.parentID ? 'subagent' : 'primary';
            return {
                type: 'agent',
                sessionId: part.sessionID,
                role,
                name: messageContext?.agent ?? part.name,
                model: messageContext?.modelID ?? '?',
                provider: messageContext?.providerID ?? '?',
                prompt: '',
                targetSessionId: agentSession?.parentID,
            } as AgentEvent & { targetSessionId?: string };
        }

        default:
            // subtask, file, snapshot, patch, retry, compaction — skip
            return null;
    }
}
