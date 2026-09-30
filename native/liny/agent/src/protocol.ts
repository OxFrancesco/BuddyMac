import { isComputerBackend, isThinkingLevel, type ComputerBackend, type ThinkingLevel } from "./config.ts";
import { isProviderId, type ModelSelection, type ProviderId } from "./provider-config.ts";

export interface WireImage {
	data: string;
	mimeType: string;
}

export interface ChatSendParams {
	tools?: "computer" | "none";
	text: string;
	images: WireImage[];
}

export type ClientRequest =
	| { type: "req"; id: number; method: "ping" }
	| { type: "req"; id: number; method: "state.get" }
	| { type: "req"; id: number; method: "chat.send"; params: ChatSendParams }
	| { type: "req"; id: number; method: "chat.abort" }
	| { type: "req"; id: number; method: "history.get" }
	| { type: "req"; id: number; method: "session.snapshot" }
	| { type: "req"; id: number; method: "session.reset" }
	| { type: "req"; id: number; method: "session.list" }
	| { type: "req"; id: number; method: "session.resume"; params: { id: string } }
	| { type: "req"; id: number; method: "auth.login"; params: AuthLoginParams }
	| { type: "req"; id: number; method: "auth.logout"; params: { provider: ProviderId } }
	| { type: "req"; id: number; method: "config.set"; params: ConfigSetParams };

export type AuthLoginParams =
	| { provider: ProviderId; method: "oauth"; mode: "device" | "browser" }
	| { provider: ProviderId; method: "api_key"; key: string };

export interface ConfigSetParams {
	computerBackend?: ComputerBackend;
	selection?: ModelSelection;
	thinking?: ThinkingLevel;
}

export type ServerMessage =
	| { type: "res"; id: number; ok: true; payload: unknown }
	| { type: "res"; id: number; ok: false; error: string }
	| ({ type: "event" } & ServerEvent);

export type ServerEvent =
	| { event: "turn.started" }
	| { event: "delta"; text: string }
	| { event: "turn.done"; usage?: UsageInfo }
	| { event: "turn.error"; message: string }
	| { event: "compacted" }
	| { event: "session.reset"; snapshot: ConversationSnapshot }
	| { event: "notice"; message: string }
	| {
			event: "tool.activity";
			turnId: string;
			toolCallId: string;
			tool: string;
			label: string;
			phase: "inspecting" | "running" | "succeeded" | "failed";
			detail?: string;
	  }
	| { event: "auth.state"; provider: ProviderId; loggedIn: boolean; source?: string }
	| { event: "auth.device_code"; userCode: string; verificationUri: string }
	| { event: "auth.url"; url: string }
	| { event: "auth.progress"; message: string }
	| { event: "auth.ok" }
	| { event: "auth.failed"; message: string };

export interface UsageInfo {
	input: number;
	output: number;
	total: number;
}

export interface HistoryMessage {
	role: "user" | "assistant";
	text: string;
	hasImages?: boolean;
}

export interface HistoryView {
	messages: HistoryMessage[];
}

export interface ConversationSnapshot extends HistoryView {
	id: string;
	provider: ProviderId;
	model: string;
	thinking: ThinkingLevel;
}

export interface StateView {
	computerBackend: ComputerBackend;
	loggedIn: boolean;
	authSource?: string;
	provider: ProviderId;
	model: string;
	providers: ProviderInfo[];
	models: { provider: ProviderId; id: string; name: string; contextWindow: number; vision: boolean }[];
	thinking: ThinkingLevel;
	sessionTurns: number;
}

export interface ProviderInfo {
	id: ProviderId;
	name: string;
	authMethods: ("api_key" | "oauth")[];
	loggedIn: boolean;
	authSource?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestId(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error("request id must be a non-negative integer");
	}
	return value;
}

function parseWireImage(value: unknown): WireImage {
	if (!isRecord(value) || typeof value.data !== "string" || typeof value.mimeType !== "string") {
		throw new Error("invalid image attachment");
	}
	if (!value.mimeType.startsWith("image/")) throw new Error("attachment must be an image");
	if (value.data.length > 30_000_000) throw new Error("image attachment is too large");
	return { data: value.data, mimeType: value.mimeType };
}

function parseChatSendParams(value: unknown): ChatSendParams {
	if (!isRecord(value) || typeof value.text !== "string") throw new Error("chat.send requires text");
	if (value.text.length > 200_000) throw new Error("chat.send text is too large");
	const rawImages = value.images ?? [];
	if (!Array.isArray(rawImages)) throw new Error("chat.send images must be an array");
	if (rawImages.length > 10) throw new Error("chat.send accepts at most 10 images");
	if (value.tools !== undefined && value.tools !== "computer" && value.tools !== "none") throw new Error("tools must be computer or none");
	return { text: value.text, images: rawImages.map(parseWireImage), tools: value.tools ?? "computer" };
}

function parseProvider(value: unknown): ProviderId {
	if (!isProviderId(value)) throw new Error("unsupported provider");
	return value;
}

function parseLoginParams(value: unknown): AuthLoginParams {
	if (!isRecord(value)) throw new Error("auth.login requires parameters");
	const provider = parseProvider(value.provider);
	if (value.method === "api_key") {
		if (typeof value.key !== "string" || !value.key.trim()) throw new Error("API key must be a non-empty string");
		if (value.key.length > 20_000) throw new Error("API key is too large");
		return { provider, method: "api_key", key: value.key.trim() };
	}
	if (value.method !== "oauth") throw new Error("auth.login method must be oauth or api_key");
	if (value.mode !== "device" && value.mode !== "browser") {
		throw new Error("auth.login mode must be device or browser");
	}
	return { provider, method: "oauth", mode: value.mode };
}

function parseLogoutParams(value: unknown): { provider: ProviderId } {
	if (!isRecord(value)) throw new Error("auth.logout requires parameters");
	return { provider: parseProvider(value.provider) };
}

function parseConfigParams(value: unknown): ConfigSetParams {
	if (!isRecord(value)) throw new Error("config.set requires parameters");
	const params: ConfigSetParams = {};
	if (value.computerBackend !== undefined) {
		if (!isComputerBackend(value.computerBackend)) throw new Error("invalid computer-use backend");
		params.computerBackend = value.computerBackend;
	}
	if (value.selection !== undefined) {
		if (!isRecord(value.selection)) throw new Error("selection must include a provider and model");
		const provider = parseProvider(value.selection.provider);
		if (typeof value.selection.model !== "string" || !value.selection.model.trim()) {
			throw new Error("model must be a non-empty string");
		}
		params.selection = { provider, model: value.selection.model };
	}
	if (value.thinking !== undefined) {
		if (!isThinkingLevel(value.thinking)) throw new Error("invalid thinking level");
		params.thinking = value.thinking;
	}
	return params;
}

export function parseClientRequest(value: unknown): ClientRequest {
	if (!isRecord(value) || value.type !== "req" || typeof value.method !== "string") {
		throw new Error("invalid request frame");
	}
	const id = parseRequestId(value.id);
	switch (value.method) {
		case "ping":
		case "state.get":
		case "chat.abort":
		case "history.get":
		case "session.snapshot":
		case "session.reset":
		case "session.list":
			return { type: "req", id, method: value.method };
		case "session.resume":
			if (!isRecord(value.params) || typeof value.params.id !== "string" || value.params.id.length > 128) throw new Error("session.resume requires a conversation id");
			return { type: "req", id, method: value.method, params: { id: value.params.id } };
		case "chat.send":
			return { type: "req", id, method: value.method, params: parseChatSendParams(value.params) };
		case "auth.login":
			return { type: "req", id, method: value.method, params: parseLoginParams(value.params) };
		case "auth.logout":
			return { type: "req", id, method: value.method, params: parseLogoutParams(value.params) };
		case "config.set":
			return { type: "req", id, method: value.method, params: parseConfigParams(value.params) };
		default:
			throw new Error(`unknown method: ${value.method}`);
	}
}
