import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { completedAssistantText, MOCK_MODE, resolveModel, type LinyRuntime } from "./agent-runtime.ts";
import type { LinyConfig } from "./config.ts";
import { runDreaming, type MemoryStorage } from "./memory.ts";
import type { ServerEvent } from "./protocol.ts";

type Emit = (event: ServerEvent) => void;

export class DreamScheduler {
	private controller: AbortController | null = null;
	private stopped = false;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private models: LinyRuntime,
		private getConfig: () => LinyConfig,
		private emit: Emit,
		private storage?: MemoryStorage,
	) {
		this.timer = setInterval(() => void this.runIfDue(), 5 * 60_000);
		void this.runIfDue();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		this.controller?.abort();
	}

	async runIfDue(): Promise<void> {
		if (MOCK_MODE || this.stopped || this.controller) return;
		const controller = new AbortController();
		this.controller = controller;
		try {
			const config = this.getConfig();
			const complete = async (system: string, content: string): Promise<string> => {
				const model = resolveModel(this.models, { provider: config.provider, model: config.model });
				const message: UserMessage = { role: "user", content, timestamp: Date.now() };
				const response = await this.models.completeSimple(
					model,
					{ systemPrompt: system, messages: [message] satisfies Message[] },
					{ reasoning: "low", signal: controller.signal },
				);
				controller.signal.throwIfAborted();
				return completedAssistantText(response);
			};
			const result = await runDreaming(complete, config, this.storage, controller.signal);
			if (result.ran) this.emit({ event: "notice", message: "Memory consolidated." });
		} catch (error) {
			if (controller.signal.aborted) return;
			this.emit({
				event: "turn.error",
				message: `memory consolidation failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}
}
