import { PluginInput } from "@opencode-ai/plugin";
import {Session} from "@opencode-ai/sdk/v2/types";

export async function findSession(id: string, plugin: PluginInput) {
    return (await plugin.client.session.get({ path: { id } })).data as Session;
}

export async function findProvider(provider: string, plugin: PluginInput) {
    const providers = (await plugin.client.provider.list()).data?.all;

    return providers?.find(p => p.id == provider)
}

export async function findModel(provider: string, model: string, plugin: PluginInput) {
    return Object.values((await findProvider(provider, plugin))?.models ?? {})
        .find(m => m.id == model);
}

export async function findModelBySession(sessionId: string, plugin: PluginInput) {
    const session = await findSession(sessionId, plugin);
    if (!session.model) return;

    return findModel(session.model.providerID, session.model.id, plugin);
}

export async function calculateContext(sessionId: string, tokens: number | undefined, plugin: PluginInput) {
    if (tokens && tokens > 0) {
        const model = await findModelBySession(sessionId, plugin);
        if (model) {
            const contextLimit = model.limit?.context;
            return contextLimit
                ? Math.min(100, (tokens / contextLimit) * 100)
                : 0;
        }
    }
}