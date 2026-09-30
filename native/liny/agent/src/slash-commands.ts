export interface SlashCommandActions {
	reset(): Promise<void>;
	remember(fact: string): void;
	showMemory(): void;
	reportUnknown(name: string): void;
}

interface SlashCommand {
	name: string;
	argument: string;
}

function parseSlashCommand(text: string): SlashCommand | null {
	const match = /^\/(\w+)(?:\s+([\s\S]+))?$/.exec(text.trim());
	const name = match?.[1];
	return name ? { name, argument: match[2]?.trim() ?? "" } : null;
}

export async function handleSlashCommand(text: string, actions: SlashCommandActions): Promise<boolean> {
	const command = parseSlashCommand(text);
	if (!command) return false;
	switch (command.name) {
		case "new":
		case "reset":
			await actions.reset();
			break;
		case "remember":
			if (command.argument) actions.remember(command.argument);
			break;
		case "memory":
			actions.showMemory();
			break;
		default:
			actions.reportUnknown(command.name);
	}
	return true;
}
