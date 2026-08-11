import {PluginInput} from '@opencode-ai/plugin'
import {openWindow, stopWindow} from "../window";
import {startBridge, stopBridge} from "../server";

export async function handleCommand(sessionId: string, args: string[], plugin: PluginInput) {
	const requested = args[0]?.toLowerCase();
	if (requested === 'off') {
        stopWindow();
        stopBridge();
        plugin.client.tui.showToast({
            body: {
                message: `AgentSpyglass off.`,
                variant: 'info'
            }
        });
		return;
	}

	await startBridge(plugin.client, sessionId);
	await openWindow(plugin.directory);
    plugin.client.tui.showToast({
        body: {
            message: `AgentSpyglass started.`,
            variant: 'info'
        }
    });
}
