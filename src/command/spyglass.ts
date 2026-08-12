import {PluginInput} from '@opencode-ai/plugin'
import {openWindow, stopWindow} from "../window";
import {startBridge, stopBridge} from "../server";
import {clearSessions} from '../service/session-storage.service';

export async function handleCommand(sessionId: string, args: string[], plugin: PluginInput) {
	const requested = args[0]?.toLowerCase();
	if (requested === 'off') {
        stopWindow();
        stopBridge();
        clearSessions();
        plugin.client.tui.showToast({
            body: {
                message: `AgentSpyglass off.`,
                variant: 'info'
            }
        });
		return;
	}

	try {
		await startBridge(plugin, sessionId);
		await openWindow(plugin.directory);
		plugin.client.tui.showToast({
			body: {
				message: `AgentSpyglass started.`,
				variant: 'info'
			}
		});
	} catch (error) {
		plugin.client.tui.showToast({
			body: {
				message: `AgentSpyglass failed to start: ${error}`,
				variant: 'error'
			}
		});
	}
}
