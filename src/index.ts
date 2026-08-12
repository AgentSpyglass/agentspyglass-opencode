import {Plugin, PluginInput} from '@opencode-ai/plugin'
import type {Event, Part, Todo} from '@opencode-ai/sdk/v2'
import {handleCommand} from './command/spyglass';
import {agentEventHandle, messageEventHandle, statusEventHandle, todoEventHandle, toolEventHandle} from "./handler/event.handler";

let SESSION_ID: string | undefined;
export const AgentSpyglass: Plugin = async (plugin: PluginInput) => {
	return {
		config: async (ocConfig) => {
			ocConfig.command ??= {}
			ocConfig.command['spyglass'] = {template: 'Do not explain, acknowledge, or comment. Output nothing at all.', description: 'Toggle SpyGlass view.'}
		},

		"chat.message": async (input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string; }; messageID?: string; variant?: string; }, output: { message: unknown; parts: Part[]; }) => {
            if (input.agent && input.model) {
                await agentEventHandle(
                    plugin,
                    input.sessionID,
                    input.agent,
                    input.model.modelID,
                    input.model.providerID,
                    output.parts
                        .filter(part => part.type == 'text')
                        .map(part => part.text)
                        .join('')
                );
            }
        },

        "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string; }, output: { args: any; }) => {
            await toolEventHandle(plugin, input.sessionID, input.callID, input.tool, 'running', output.args);
        },

        "tool.execute.after": async (input: { tool: string; sessionID: string; callID: string; args: any; }, _: any) => {
            await toolEventHandle(plugin, input.sessionID, input.callID, input.tool, 'completed', input.args);
        },

		"command.execute.before": async (input: { command: string; arguments: string; sessionID: string; }, output: { parts: Part[]; }) => {
			const cmd = (output as any).command ?? input.command;
			const args = ((output as any).args ?? input.arguments).trim();
            SESSION_ID = input.sessionID;

            if (cmd === 'spyglass') {
				await handleCommand(SESSION_ID, args.split(/\s+/), plugin);
				return;
			}
		},

        event: async (input: { event: Event }) => {
            const { event } = input;
            switch (event.type) {
                case 'todo.updated':
                    await todoEventHandle(
                        plugin,
                        event.properties.sessionID,
                        event.properties.todos
                    );
                    return;

                case 'message.part.updated':
                    await handlePartUpdated(plugin, event.properties.part);
                    return;
            }
        }


	}
}

async function handlePartUpdated(plugin: PluginInput, part: Part) {
    switch (part.type) {
        case 'step-start':
        case 'reasoning':
        case 'step-finish': {
            let cost: number | undefined;
            let tokens: number | undefined;
            if (part.type === 'step-finish') {
                cost = part.cost;
                tokens = part.tokens.total;
            }

            await statusEventHandle(plugin, part.sessionID, part.type, tokens, cost);
            break;
        }
        case 'text':
            await messageEventHandle(plugin, part.sessionID, part.text);
            break;
    }
}