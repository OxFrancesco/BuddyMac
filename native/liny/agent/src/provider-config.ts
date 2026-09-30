export const PROVIDER_IDS = ["liny", "openai-codex", "openrouter", "zai"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ModelSelection {
	provider: ProviderId;
	model: string;
}

const DEFAULT_MODELS = {
	liny: "openai/gpt-4.1-mini",
	"openai-codex": "gpt-5.6-sol",
	openrouter: "anthropic/claude-sonnet-4.6",
	zai: "glm-5.3",
} satisfies Record<ProviderId, string>;

export function isProviderId(value: unknown): value is ProviderId {
	return PROVIDER_IDS.some((provider) => provider === value);
}

export function defaultModelFor(provider: ProviderId): string {
	return DEFAULT_MODELS[provider];
}
