import type { AuthPrompt } from "@earendil-works/pi-ai";
import { MOCK_MODE, runtimeProviderId, type LinyRuntime } from "./agent-runtime.ts";
import type { AuthLoginParams, ServerEvent } from "./protocol.ts";
import type { ProviderId } from "./provider-config.ts";

type Emit = (event: ServerEvent) => void;

export interface AuthState {
	loggedIn: boolean;
	source?: string;
}

export async function answerAuthPrompt(
	mode: "device" | "browser",
	prompt: AuthPrompt,
): Promise<string> {
	switch (prompt.type) {
		case "select": {
			const preferredId = mode === "browser" ? "browser" : "device_code";
			const option = prompt.options.find((candidate) => candidate.id === preferredId);
			if (!option) throw new Error(`sign-in provider does not support ${mode} login`);
			return option.id;
		}
		case "manual_code": {
			if (mode !== "browser" || !prompt.signal) {
				throw new Error("manual sign-in code entry is not supported");
			}
			if (prompt.signal.aborted) throw new Error("sign-in prompt cancelled");
			return new Promise<string>((_resolve, reject) => {
				prompt.signal?.addEventListener(
					"abort",
					() => reject(new Error("sign-in prompt cancelled")),
					{ once: true },
				);
			});
		}
		case "text":
		case "secret":
			throw new Error(`unsupported sign-in prompt: ${prompt.type}`);
		default: {
			const exhaustive: never = prompt;
			throw new Error(`unsupported sign-in prompt: ${String(exhaustive)}`);
		}
	}
}

export function answerApiKeyPrompt(key: string, prompt: AuthPrompt): Promise<string> {
	if (prompt.type !== "secret") throw new Error(`unexpected API key prompt: ${prompt.type}`);
	return Promise.resolve(key);
}

export class AuthController {
	private loginController: AbortController | null = null;

	constructor(
		private models: LinyRuntime,
		private emit: Emit,
	) {}

	stop(): void {
		this.loginController?.abort();
		this.loginController = null;
	}

	async state(provider: ProviderId): Promise<AuthState> {
		if (MOCK_MODE) return { loggedIn: true, source: "Mock" };
		try {
			const auth = await this.models.getAuth(runtimeProviderId(provider));
			return { loggedIn: Boolean(auth), ...(auth?.source ? { source: auth.source } : {}) };
		} catch {
			return { loggedIn: false };
		}
	}

	async login(params: AuthLoginParams): Promise<void> {
		if (MOCK_MODE) {
			this.emit({ event: "auth.ok" });
			this.emit({ event: "auth.state", provider: params.provider, loggedIn: true, source: "Mock" });
			return;
		}
		if (this.loginController) throw new Error("sign-in already running");
		const controller = new AbortController();
		this.loginController = controller;
		try {
			await this.models.login(runtimeProviderId(params.provider), params.method, {
				prompt: (prompt) => params.method === "api_key"
					? answerApiKeyPrompt(params.key, prompt)
					: answerAuthPrompt(params.mode, prompt),
				notify: (event) => {
					switch (event.type) {
						case "device_code":
							this.emit({
								event: "auth.device_code",
								userCode: event.userCode,
								verificationUri: event.verificationUri,
							});
							break;
						case "progress":
							this.emit({ event: "auth.progress", message: event.message });
							break;
						case "auth_url":
							this.emit({ event: "auth.url", url: event.url });
							break;
						case "info":
							this.emit({ event: "auth.progress", message: event.message });
							break;
					}
				},
				signal: controller.signal,
			});
			this.emit({ event: "auth.ok" });
			await this.emitState(params.provider);
			await this.models.refresh({ providers: [runtimeProviderId(params.provider)] });
		} catch (error) {
			this.emit({ event: "auth.failed", message: error instanceof Error ? error.message : String(error) });
			throw error;
		} finally {
			if (this.loginController === controller) this.loginController = null;
		}
	}

	async logout(provider: ProviderId): Promise<void> {
		await this.models.logout(runtimeProviderId(provider));
		await this.emitState(provider);
	}

	async emitState(provider: ProviderId): Promise<void> {
		const state = await this.state(provider);
		this.emit({ event: "auth.state", provider, ...state });
	}
}
