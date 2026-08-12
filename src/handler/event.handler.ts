import {broadcastEvent} from '../server';
import {AgentEvent, MessageEvent, StatusEvent, TodoEvent, ToolEvent} from "@agentspyglass/core"
import { getSession, saveSession } from "../service/session-storage.service";
import { findSession } from "../util/opencode.util";
import { PluginInput } from "@opencode-ai/plugin";
import { Todo } from '@opencode-ai/sdk/v2';

export async function agentEventHandle(plugin: PluginInput, sessionId: string, name: string, model: string, provider?: string, prompt?: string) {
    const session = await findSession(sessionId, plugin);
    const role = session?.parentID? 'subagent' : 'primary'
    saveSession(
        {
            id: sessionId,
            agent: name,
            model,
            role,
            cost: 0,
            total: 0,
            parentId: session?.parentID,
        }
    );

    broadcastEvent({
        type: 'agent',
        sessionId,
        name,
        model,
        provider,
        prompt,
        role
    } as AgentEvent);
}

export async function toolEventHandle(plugin: PluginInput, sessionId: string, callId: string, name: string, status: 'running' | 'completed', input?: any) {
    await verifySession(plugin, sessionId);

    broadcastEvent({
        type: 'tool',
        sessionId,
        callId,
        name,
        input,
        status
    } as ToolEvent);
}

export async function statusEventHandle(plugin: PluginInput, sessionId: string, status: 'step-start' | 'reasoning' | 'step-finish', tokens?: number, cost?: number) {
    await verifySession(plugin, sessionId);

    broadcastEvent({
        type: 'status',
        sessionId,
        status,
        tokens,
        cost
    } as StatusEvent);
}

export async function messageEventHandle(plugin: PluginInput, sessionId: string, content: string) {
    await verifySession(plugin, sessionId);

    broadcastEvent({
        type: 'message',
        sessionId,
        content
    } as MessageEvent);
}

export async function todoEventHandle(plugin: PluginInput, sessionId: string, todos: Todo[]) {
    await verifySession(plugin, sessionId);

    broadcastEvent({
        type: 'todo',
        sessionId,
        todos
    } as TodoEvent);
}

async function verifySession(plugin: PluginInput, sessionId: string) {
    const sessionHold = getSession(sessionId);
    if (!sessionHold) {
        await agentEventHandle(plugin, sessionId, '?', '?', '?', undefined);
    }
}
