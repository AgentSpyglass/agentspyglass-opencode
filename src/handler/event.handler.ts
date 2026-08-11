import {broadcastEvent} from '../server';
import {AgentEvent, MessageEvent, StatusEvent, ToolEvent} from "@agentspyglass/core"
import { getSession, saveSession } from "../holder/session.holder";
import { findSession } from "../util/session.util";
import { PluginInput } from "@opencode-ai/plugin";

export async function agentEventHandle(plugin: PluginInput, sessionId: string, name: string, model: string, provider?: string, prompt?: string) {
    const session = await findSession(sessionId, plugin);
    const role = session?.parentID? 'subagent' : 'primary'
    saveSession(
        {
            id: sessionId,
            agent: name,
            model,
            role
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

export async function statusEventHandle(plugin: PluginInput, sessionId: string, status: 'step-start' | 'reasoning' | 'step-finish') {
    await verifySession(plugin, sessionId);

    broadcastEvent({
        type: 'status',
        sessionId,
        status
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

async function verifySession(plugin: PluginInput, sessionId: string) {
    const sessionHold = getSession(sessionId);
    if (!sessionHold) {
        await agentEventHandle(plugin, sessionId, '?', '?', '?', undefined);
    }
}
