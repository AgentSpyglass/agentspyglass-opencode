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

    const computedTokens: TokenBreakdown | undefined = existing?.tokens ?? (session?.tokens ? {
        total: session.tokens.input + session.tokens.output + session.tokens.reasoning,
        input: session.tokens.input,
        output: session.tokens.output,
        reasoning: session.tokens.reasoning,
        cache: session.tokens.cache,
    } : undefined);

    saveSession(
        {
            id: sessionId,
            agent: session?.agent ?? '',
            model: session?.model?.id ?? '',
            provider: session?.model?.providerID ?? '',
            role,
            cost: existing?.cost ?? session?.cost ?? 0,
            parentId: session?.parentID,
            tokens: computedTokens
        }
    );

    broadcastEvent({
        type: 'agent',
        sessionId,
        name: session?.agent ?? '',
        model: session?.model?.id ?? '',
        provider: session?.model?.providerID ?? '',
        prompt,
        role,
        cost: session?.cost ?? 0,
        tokens: computedTokens?.total ?? 0,
        targetSessionId: session?.parentID,
    } as AgentEvent & { targetSessionId?: string });
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
    contextUsed?: number,
    tokenBreakdown?: TokenBreakdown
) {
    await verifySession(plugin, sessionId);

    // Accumulate cost/tokens into session storage on step-finish
    if (status === 'step-finish') {
        const sessionHold = getSession(sessionId);
        if (sessionHold) {
            if (cost !== undefined) sessionHold.cost += cost;
            if (tokenBreakdown) {
                if (!sessionHold.tokens) {
                    sessionHold.tokens = { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
                }
                sessionHold.tokens.total += tokenBreakdown.total;
                sessionHold.tokens.input += tokenBreakdown.input;
                sessionHold.tokens.output += tokenBreakdown.output;
                sessionHold.tokens.reasoning += tokenBreakdown.reasoning;
                sessionHold.tokens.cache.read += tokenBreakdown.cache.read;
                sessionHold.tokens.cache.write += tokenBreakdown.cache.write;
            } else if (tokens !== undefined) {
                if (!sessionHold.tokens) {
                    sessionHold.tokens = { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
                }
                sessionHold.tokens.total += tokens;
            }
            saveSession(sessionHold);
        }
    }

    broadcastEvent({
        type: 'status',
        sessionId,
        status,
        cost,
        contextUsed,
        tokens: tokenBreakdown ? {
            total: tokens ?? tokenBreakdown.total,
            input: tokenBreakdown.input,
            output: tokenBreakdown.output,
            reasoning: tokenBreakdown.reasoning,
            cache: tokenBreakdown.cache,
        } : (tokens !== undefined ? { total: tokens, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } : undefined),
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
