import {broadcastEvent} from '../server';
import {AgentEvent, MessageEvent, StatusEvent, TodoEvent, ToolEvent} from "@agentspyglass/core"
import { getSession, saveSession } from "../service/session-storage.service";
import { findSession } from "../util/opencode.util";
import { PluginInput } from "@opencode-ai/plugin";
import { Todo } from '@opencode-ai/sdk/v2';
import type { TokenBreakdown } from "../model/definitions";

export async function agentEventHandle(plugin: PluginInput, sessionId: string, prompt?: string) {
    const session = await findSession(sessionId, plugin);
    const role = session?.parentID? 'subagent' : 'primary'
    const existing = getSession(sessionId);

    saveSession(
        {
            id: sessionId,
            agent: session.agent ?? '',
            model: session.model?.id ?? '',
            provider: session.model?.providerID ?? '',
            role,
            cost: existing?.cost ?? session.cost ?? 0,
            total: existing?.total ?? (session.tokens
                ? session.tokens.input + session.tokens.output + session.tokens.reasoning
                : 0),
            parentId: session?.parentID,
            tokens: existing?.tokens ?? (session.tokens ? {
                input: session.tokens.input,
                output: session.tokens.output,
                reasoning: session.tokens.reasoning,
                cache: session.tokens.cache,
            } : undefined),
            modelRef: existing?.modelRef ?? (session.model ? {
                id: session.model.id,
                providerID: session.model.providerID,
                variant: session.model.variant,
            } : undefined),
            currentAgent: session.agent ?? '',
        }
    );

    broadcastEvent({
        type: 'agent',
        sessionId,
        name: session.agent ?? '',
        model: session.model?.id ?? '',
        provider: session.model?.providerID ?? '',
        prompt,
        role,
        cost: session.cost ?? 0,
        tokens: session.tokens?.input
            ? session.tokens.input + session.tokens.output + session.tokens.reasoning
            : 0,
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

export async function statusEventHandle(
    plugin: PluginInput,
    sessionId: string,
    status: 'step-start' | 'reasoning' | 'step-finish',
    tokens?: number,
    cost?: number,
    tokenBreakdown?: TokenBreakdown
) {
    await verifySession(plugin, sessionId);

    // Accumulate cost/tokens into session storage on step-finish
    if (status === 'step-finish') {
        const sessionHold = getSession(sessionId);
        if (sessionHold) {
            if (cost !== undefined) sessionHold.cost += cost;
            if (tokens !== undefined) sessionHold.total += tokens;
            if (tokenBreakdown) {
                if (!sessionHold.tokens) {
                    sessionHold.tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
                }
                sessionHold.tokens.input += tokenBreakdown.input;
                sessionHold.tokens.output += tokenBreakdown.output;
                sessionHold.tokens.reasoning += tokenBreakdown.reasoning;
                sessionHold.tokens.cache.read += tokenBreakdown.cache.read;
                sessionHold.tokens.cache.write += tokenBreakdown.cache.write;
            }
            saveSession(sessionHold);
        }
    }

    broadcastEvent({
        type: 'status',
        sessionId,
        status,
        tokens,
        cost,
        tokenBreakdown,
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
        await agentEventHandle(plugin, sessionId, '?');
    }
}
