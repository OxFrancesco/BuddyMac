import type { OpenAICodexResponsesOptions, SimpleStreamOptions } from "@earendil-works/pi-ai";

export function fastStreamOptions(options?: SimpleStreamOptions): OpenAICodexResponsesOptions {
	const { reasoning, ...base } = options ?? {};
	return {
		...base,
		reasoningEffort: reasoning ?? "low",
		serviceTier: "priority",
		textVerbosity: "low",
	};
}
