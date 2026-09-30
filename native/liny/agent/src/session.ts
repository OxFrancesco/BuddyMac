import { readFileSync } from "node:fs";
import type { Message, TextContent, UserMessage } from "@earendil-works/pi-ai";
import type { HistoryMessage, HistoryView } from "./protocol.ts";

export type SessionEntry =
	| { type: "message"; message: Message }
	| { type: "compaction"; summary: string; at: number };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentBlockType(value: unknown): string | null {
	if (!isRecord(value) || typeof value.type !== "string") return null;
	switch (value.type) {
		case "text":
			return typeof value.text === "string" ? value.type : null;
		case "image":
			return typeof value.data === "string" && typeof value.mimeType === "string" ? value.type : null;
		case "thinking":
			return typeof value.thinking === "string" ? value.type : null;
		case "toolCall":
			return typeof value.id === "string" && typeof value.name === "string" && isRecord(value.arguments)
				? value.type
				: null;
		default:
			return null;
	}
}

const USER_CONTENT_TYPES = new Set(["text", "image"]);
const ASSISTANT_CONTENT_TYPES = new Set(["text", "thinking", "toolCall"]);

function hasOnlyContentTypes(value: unknown, allowed: Set<string>): boolean {
	return Array.isArray(value) && value.every((block) => {
		const type = contentBlockType(block);
		return type !== null && allowed.has(type);
	});
}

function isUsage(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.input === "number" &&
		typeof value.output === "number" &&
		typeof value.cacheRead === "number" &&
		typeof value.cacheWrite === "number" &&
		typeof value.totalTokens === "number"
	);
}

function isMessage(value: unknown): value is Message {
	if (!isRecord(value) || typeof value.role !== "string" || typeof value.timestamp !== "number") return false;
	if (value.role === "user") {
		return typeof value.content === "string" || hasOnlyContentTypes(value.content, USER_CONTENT_TYPES);
	}
	if (value.role === "assistant") {
		return (
			hasOnlyContentTypes(value.content, ASSISTANT_CONTENT_TYPES) &&
			typeof value.api === "string" &&
			typeof value.provider === "string" &&
			typeof value.model === "string" &&
			isUsage(value.usage) &&
			typeof value.stopReason === "string"
		);
	}
	if (value.role === "toolResult") {
		return (
			typeof value.toolCallId === "string" &&
			typeof value.toolName === "string" &&
			hasOnlyContentTypes(value.content, USER_CONTENT_TYPES) &&
			typeof value.isError === "boolean"
		);
	}
	return false;
}

function parseSessionEntry(value: unknown): SessionEntry | null {
	if (!isRecord(value)) return null;
	if (value.type === "message" && isMessage(value.message)) return { type: "message", message: value.message };
	if (value.type === "compaction" && typeof value.summary === "string" && typeof value.at === "number") {
		return { type: "compaction", summary: value.summary, at: value.at };
	}
	return null;
}

export function loadSession(path: string): SessionEntry[] {
	const entries: SessionEntry[] = [];
	try {
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = parseSessionEntry(JSON.parse(line));
				if (entry) entries.push(entry);
			} catch {
				// A truncated final line should not make the earlier session unreadable.
			}
		}
	} catch {
		return [];
	}
	return entries;
}

function summaryMessage(summary: string): UserMessage {
	return {
		role: "user",
		content: `<conversation-summary>\n${summary}\n</conversation-summary>\n\nContinue from this summary.`,
		timestamp: 0,
	};
}

export function buildContextMessages(entries: SessionEntry[]): Message[] {
	const messages: Message[] = [];
	let summary: string | null = null;
	for (const entry of entries) {
		if (entry.type === "compaction") {
			summary = entry.summary;
			messages.length = 0;
		} else {
			messages.push(entry.message);
		}
	}
	if (summary) messages.unshift(summaryMessage(summary));
	return messages;
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
}

export function historyView(entries: SessionEntry[]): HistoryView {
	const messages: HistoryMessage[] = [];
	for (const message of buildContextMessages(entries)) {
		if (message.role === "toolResult") continue;
		if (typeof message.content === "string" && message.content.startsWith("<conversation-summary>")) continue;
		const text = messageText(message)
			.replace(/<conversation-summary>[\s\S]*?<\/conversation-summary>/g, "")
			.trim();
		const hasImages = Array.isArray(message.content) && message.content.some((block) => block.type === "image");
		if (text || hasImages) {
			messages.push({
				role: message.role,
				text,
				...(hasImages ? { hasImages: true } : {}),
			});
		}
	}
	return { messages };
}

export function estimateMessageTokens(message: Message): number {
	if (typeof message.content === "string") return Math.ceil(message.content.length / 4);
	let tokens = 0;
	for (const block of message.content) {
		switch (block.type) {
			case "image":
				tokens += 4_800;
				break;
			case "text":
				tokens += Math.ceil(block.text.length / 4);
				break;
			case "thinking":
				tokens += Math.ceil(block.thinking.length / 4);
				break;
			case "toolCall":
				tokens += Math.ceil((block.name.length + JSON.stringify(block.arguments).length) / 4);
				break;
		}
	}
	return tokens;
}

export function estimateTokens(entries: SessionEntry[]): number {
	return entries.reduce(
		(total, entry) =>
			total + (entry.type === "message" ? estimateMessageTokens(entry.message) : Math.ceil(entry.summary.length / 4)),
		0,
	);
}
