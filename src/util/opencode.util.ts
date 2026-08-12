import { PluginInput } from "@opencode-ai/plugin";

export async function findSession(id: string, plugin: PluginInput) {
    return (await plugin.client.session.get({ path: { id } })).data;
}