import type { Api, Message, Model, TextContent, UserMessage } from "@earendil-works/pi-ai";
import { buildContextMessages, estimateMessageTokens, type SessionEntry } from "./session.ts";

export const MUST_PRESERVE = `When summarizing, you MUST preserve:
- Active tasks and anything the user asked you to do or follow up on
- Decisions and preferences the user stated
- Names, dates, numbers, URLs, file paths, and identifiers verbatim
- Open questions and unresolved threads
- The last thing the user requested`;

const SUMMARY_PROMPT = `Summarize this conversation excerpt for continuity. Write in second person for the user and first person for your commitments.
Keep it dense and under 600 words.

${MUST_PRESERVE}`;

export function shouldCompact(
	tokens: number,
	model: Pick<Model<Api>, "contextWindow">,
	reserveTokens: number,
): boolean {
	if (tokens <= 0) return false;
	return tokens > Math.max(model.contextWindow - reserveTokens, 4_000);
}

function contentText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join(" ");
}

export function findCompactionSplit(messages: Message[], keepRecentTokens: number): number {
	let retainedTokens = 0;
	for (let index = messages.length - 1; index > 0; index--) {
		const message = messages[index];
		if (!message) continue;
		retainedTokens += estimateMessageTokens(message);
		if (retainedTokens >= keepRecentTokens && message.role === "user") return index;
	}
	return 0;
}

export async function compactEntries(
	entries: SessionEntry[],
	complete: (system: string, messages: Message[]) => Promise<string>,
	keepRecentTokens: number,
): Promise<SessionEntry[]> {
	const messages = buildContextMessages(entries);
	if (messages.length < 3) return entries;

	const splitAt = findCompactionSplit(messages, keepRecentTokens);
	if (splitAt === 0) return entries;

	const transcript = messages
		.slice(0, splitAt)
		.map((message) => `${message.role.toUpperCase()}: ${contentText(message)}`)
		.join("\n\n");
	const summaryRequest: UserMessage = {
		role: "user",
		content: `<transcript>\n${transcript}\n</transcript>`,
		timestamp: Date.now(),
	};

	let summary: string;
	try {
		summary = await complete(SUMMARY_PROMPT, [summaryRequest]);
	} catch (error) {
		throw new Error(`compaction failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!summary.trim()) throw new Error("compaction produced empty summary");

	return [
		{ type: "compaction", summary: summary.trim(), at: Date.now() },
		...messages.slice(splitAt).map((message): SessionEntry => ({ type: "message", message })),
	];
}
