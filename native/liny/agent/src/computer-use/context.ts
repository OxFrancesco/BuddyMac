import type { Message } from "@earendil-works/pi-ai";

interface Screenshot {
	message: number;
	block: number;
	app: string;
	comparison: boolean;
}

/** Keep current tool views and one explicit comparison per app. User attachments are untouched. */
export function boundComputerScreenshots(messages: Message[], maxImages = 8): Message[] {
	const candidates: Screenshot[] = [];
	for (const [index, message] of messages.entries()) {
		if (message.role !== "toolResult" || !(message.toolName.startsWith("ocu_") || message.toolName.startsWith("stagehand_"))) continue;
		const details: unknown = message.details;
		const apps = details && typeof details === "object" && "imageApps" in details && Array.isArray(details.imageApps)
			? details.imageApps.filter((app: unknown): app is string => typeof app === "string") : [];
		const comparison = !!details && typeof details === "object" && "comparison" in details && details.comparison === true;
		let imageIndex = 0;
		for (const [block, content] of message.content.entries()) {
			if (content.type !== "image") continue;
			candidates.push({ message: index, block, app: apps[imageIndex++] ?? "unknown", comparison });
		}
	}
	const selected = new Set<Screenshot>();
	const latestApps = new Set<string>();
	const comparisonApps = new Set<string>();
	for (const shot of [...candidates].reverse()) {
		if (selected.size >= maxImages) break;
		if (!latestApps.has(shot.app)) {
			selected.add(shot);
			latestApps.add(shot.app);
			if (shot.comparison) comparisonApps.add(shot.app);
		} else if (shot.comparison && !comparisonApps.has(shot.app)) {
			selected.add(shot);
			comparisonApps.add(shot.app);
		}
	}
	const omitted = new Map<string, string>();
	for (const shot of candidates) if (!selected.has(shot)) omitted.set(`${shot.message}:${shot.block}`, shot.app);
	return messages.map((message, index) => {
		if (message.role !== "toolResult") return message;
		return { ...message, content: message.content.map((block, blockIndex) => {
			const app = omitted.get(`${index}:${blockIndex}`);
			return app ? { type: "text" as const, text: `[Earlier screenshot of ${app} omitted. Text observations remain; at most eight tool images are retained.]` } : block;
		}) };
	});
}
