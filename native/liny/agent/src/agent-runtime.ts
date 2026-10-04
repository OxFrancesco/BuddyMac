import type { Api, Context, Message } from "@earendil-works/pi-ai";
import { createModels, fauxAssistantMessage, fauxProvider, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { FileCredentialStore } from "./authstore.ts";
import { fastStreamOptions } from "./fast-stream.ts";
import { AUTH_FILE } from "./paths.ts";
import { durableModels } from '../../../../src/durable-models';
import { dirname, join } from 'node:path';
import { defaultModelFor, PROVIDER_IDS, type ModelSelection, type ProviderId } from "./provider-config.ts";

registerBunOAuthFlows();

export const MOCK_PROVIDER_ID = "faux";
export const MOCK_MODE = process.env.LINY_MOCK === "1";

export type LinyRuntime = ReturnType<typeof createRuntime>;

export interface RuntimeModelInfo {
	provider: ProviderId;
	id: string;
	name: string;
	contextWindow: number;
	vision: boolean;
}

export interface RuntimeProviderInfo {
	id: ProviderId;
	name: string;
	authMethods: ("api_key" | "oauth")[];
}

export function runtimeProviderId(provider: ProviderId): string {
	return MOCK_MODE ? MOCK_PROVIDER_ID : provider;
}

export function createRuntime(authPath = AUTH_FILE) {
	if (MOCK_MODE) {
		const models = createModels();
		const faux = fauxProvider({
			models: [
				{
					id: "gpt-5.6-sol",
					name: "Mock GPT-5.6 Sol",
					reasoning: true,
					input: ["text", "image"],
					contextWindow: 272_000,
				},
			],
			tokensPerSecond: 400,
		});
		models.setProvider(faux.provider);
		const echo = (context: Context) => {
			const lastMessage = context.messages.at(-1);
			const content = typeof lastMessage?.content === "string" ? lastMessage.content : "[image attached]";
			return fauxAssistantMessage(
				`[mock] You said: ${JSON.stringify(content)}\n\nMemory included: ${context.systemPrompt?.includes("<memory>") ? "yes" : "no"}.`,
			);
		};
		faux.setResponses(Array.from({ length: 10_000 }, () => echo));
        return durableModels(models, join(dirname(authPath), 'inference'));
	}
	const credentials = new FileCredentialStore(authPath);
	const models = createModels({ credentials });
	models.setProvider(openaiCodexProvider());
	models.setProvider(openrouterProvider());
	models.setProvider(zaiProvider());
    return durableModels(models, join(dirname(authPath), 'inference'));
}

export function resolveModel(models: ReturnType<typeof createRuntime>, selection: ModelSelection): Model<Api> {
	const providerId = runtimeProviderId(selection.provider);
	const model =
		models.getModel(providerId, selection.model) ??
		models.getModel(providerId, MOCK_MODE ? selection.model : defaultModelFor(selection.provider)) ??
		models.getModels(providerId)[0];
	if (!model) throw new Error(`no models available for provider ${providerId}`);
	return model;
}

export function listModels(models: ReturnType<typeof createRuntime>): RuntimeModelInfo[] {
	if (MOCK_MODE) {
		return models
			.getModels(MOCK_PROVIDER_ID)
			.map((m: Model<Api>) => ({
				provider: "openai-codex" satisfies ProviderId,
				id: m.id,
				name: m.name,
				contextWindow: m.contextWindow,
				vision: true,
			}));
	}
	return PROVIDER_IDS.flatMap((provider) =>
		models.getModels(provider).map((m: Model<Api>) => ({
			provider,
			id: m.id,
			name: m.name,
			contextWindow: m.contextWindow,
			vision: (m.input ?? []).includes("image"),
		})),
	);
}

export function listProviders(models: ReturnType<typeof createRuntime>): RuntimeProviderInfo[] {
	if (MOCK_MODE) {
		return [{
			id: "openai-codex" satisfies ProviderId,
			name: "OpenAI Codex",
			authMethods: ["oauth" as const, "api_key" as const],
		}];
	}
	return PROVIDER_IDS.flatMap((id) => {
		const provider = models.getProvider(id);
		return provider
			? [{
				id,
				name: provider.name,
				authMethods: id === "liny" ? [] : [
					...(provider.auth.oauth ? ["oauth" as const] : []),
					...(provider.auth.apiKey ? ["api_key" as const] : []),
				],
			}]
			: [];
	});
}

export async function streamTurn(
	models: ReturnType<typeof createRuntime>,
	model: Model<Api>,
	systemPrompt: string,
	messages: Message[],
	thinking: "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
	signal: AbortSignal,
	onDelta: (text: string) => void,
): Promise<AssistantMessage> {
	const context = { systemPrompt, messages };
	const options = { signal, reasoning: thinking };
	const stream = model.api === "openai-codex-responses"
		? models.stream(model as Model<"openai-codex-responses">, context, fastStreamOptions(options))
		: models.streamSimple(model, context, options);
	for await (const ev of stream) {
		if (ev.type === "text_delta") onDelta(ev.delta);
	}
	const final = await stream.result();
	if (final.stopReason === "error") throw new Error(final.errorMessage ?? "stream error");
	if (final.stopReason === "aborted") throw Object.assign(new Error("aborted"), { name: "AbortError" });
	return final;
}

export function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

export function completedAssistantText(message: AssistantMessage): string {
	if (message.stopReason !== "stop") {
		throw new Error(message.errorMessage ?? `Model completion ended with ${message.stopReason}.`);
	}
	return assistantText(message);
}

export function usageOf(message: AssistantMessage) {
	const u = message.usage;
	return { input: u.input + u.cacheRead + u.cacheWrite, output: u.output, total: u.totalTokens };
}
