import { readFileSync } from "node:fs";
import { CONFIG_FILE } from "./paths.ts";
import { writePrivateFile } from "./private-files.ts";
import { defaultModelFor, isProviderId, type ProviderId } from "./provider-config.ts";

export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ComputerBackend = "ocu" | "stagehand";

export function isComputerBackend(value: unknown): value is ComputerBackend {
	return value === "ocu" || value === "stagehand";
}

export interface LinyConfig {
	computerBackend: ComputerBackend;
	port: number;
	provider: ProviderId;
	model: string;
	thinking: ThinkingLevel;
	compactionReserveTokens: number;
	keepRecentTokens: number;
	memoryBootstrapMaxChars: number;
	dreamHour: number;
	dailyNoteRetentionDays: number;
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
	);
}

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function environmentPort(): number {
	const candidate = Number(process.env.LINY_PORT);
	return validInteger(candidate, 1, 65_535) ? candidate : 8699;
}

export function defaultConfig(): LinyConfig {
	return {
		port: environmentPort(),
		computerBackend: "ocu",
		provider: "openai-codex",
		model: defaultModelFor("openai-codex"),
		thinking: "low",
		compactionReserveTokens: 24_000,
		keepRecentTokens: 8_000,
		memoryBootstrapMaxChars: 12_000,
		dreamHour: 3,
		dailyNoteRetentionDays: 14,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfig(value: unknown, defaults: LinyConfig = defaultConfig()): LinyConfig {
	if (!isRecord(value)) return defaults;
	const provider = value.provider === undefined
		? defaults.provider
		: isProviderId(value.provider)
			? value.provider
			: defaults.provider;
	const model = typeof value.model === "string" && value.model.trim()
		? value.provider !== undefined && !isProviderId(value.provider)
			? defaults.model
			: value.model
		: provider === defaults.provider
			? defaults.model
			: defaultModelFor(provider);
	return {
		computerBackend: isComputerBackend(value.computerBackend) ? value.computerBackend : defaults.computerBackend,
		port: validInteger(value.port, 1, 65_535) ? value.port : defaults.port,
		provider,
		model,
		thinking: isThinkingLevel(value.thinking) ? value.thinking : defaults.thinking,
		compactionReserveTokens: validInteger(value.compactionReserveTokens, 1_000, 1_000_000)
			? value.compactionReserveTokens
			: defaults.compactionReserveTokens,
		keepRecentTokens: validInteger(value.keepRecentTokens, 1_000, 1_000_000)
			? value.keepRecentTokens
			: defaults.keepRecentTokens,
		memoryBootstrapMaxChars: validInteger(value.memoryBootstrapMaxChars, 1_000, 1_000_000)
			? value.memoryBootstrapMaxChars
			: defaults.memoryBootstrapMaxChars,
		dreamHour: validInteger(value.dreamHour, 0, 23) ? value.dreamHour : defaults.dreamHour,
		dailyNoteRetentionDays: validInteger(value.dailyNoteRetentionDays, 1, 3_650)
			? value.dailyNoteRetentionDays
			: defaults.dailyNoteRetentionDays,
	};
}

const cached = new Map<string, LinyConfig>();

export function loadConfig(path = CONFIG_FILE, defaults = defaultConfig()): LinyConfig {
	const existing = cached.get(path);
	if (existing) return existing;
	let config: LinyConfig;
	try {
		config = parseConfig(JSON.parse(readFileSync(path, "utf8")), defaults);
	} catch {
		config = defaults;
	}
	cached.set(path, config);
	return config;
}

export function updateConfig(patch: Partial<LinyConfig>, path = CONFIG_FILE): LinyConfig {
	const next = parseConfig({ ...loadConfig(path), ...patch });
	writePrivateFile(path, JSON.stringify(next, null, "\t"));
	cached.set(path, next);
	return next;
}
