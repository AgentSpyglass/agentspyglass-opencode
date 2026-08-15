import { PluginInput } from "@opencode-ai/plugin";
import {Session} from "@opencode-ai/sdk/v2/types";

export async function findSession(id: string, plugin: PluginInput) {
    return (await plugin.client.session.get({ path: { id } })).data as Session;
}