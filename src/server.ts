import fs from "node:fs/promises"
import type {Server, ServerWebSocket} from "bun"
import {OpencodeClient} from "@opencode-ai/sdk"
import {Event} from "@agentspyglass/core"

const PORT = Number(process.env.AGENTSPYGLASS_PORT ?? 51763)
const HOST = "127.0.0.1"

let server: Server<any> | undefined
const clients = new Set<ServerWebSocket<unknown>>()

export async function startBridge(client: OpencodeClient, sessionId: string) {
    if (server) return;

    server = Bun.serve({
        hostname: HOST,
        port: PORT,
        fetch: (request) => {
            if (server?.upgrade(request)) return;
            return new Response("AgentSpyglass bridge is running", {status: 200});
        },
        websocket: {
            open(ws) {
                clients.add(ws);
                populateClient(ws, client, sessionId);
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

function populateClient(ws: ServerWebSocket, client: OpencodeClient, sessionId: string) {
    try {
        client.session.todo({
            path: {
                id: sessionId,
            }
        }).then(todo => {
            ws.send(JSON.stringify({
                type: 'todo.update',
                properties: {
                    todos: todo.data
                }
            }));
        });

        client.session.messages({
            path: {
                id: sessionId,
            }
        }).then(async response => {
            if (response && response.data) {
                await fs.writeFile('./history.json', JSON.stringify(response, null, 2), 'utf-8');

                for (let message of response.data) {
                    for (let part of message.parts) {
                        ws.send(JSON.stringify({
                            type: 'message.part.updated',
                            properties: {
                                part: part
                            }
                        }));
                    }
                }
            }
        })
    } catch {
        clients.delete(ws)
    }
}
