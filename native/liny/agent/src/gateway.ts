import type { Api, Message, Model, UserMessage } from "@earendil-works/pi-ai";
import {
	completedAssistantText,
	type LinyRuntime,
	listModels,
	listProviders,
	resolveModel,
	runtimeProviderId,
} from "./agent-runtime.ts";
import { AuthController } from "./auth-controller.ts";
import { compactEntries, shouldCompact } from "./compaction.ts";
import { isThinkingLevel, updateConfig, type LinyConfig } from "./config.ts";
import { DreamScheduler } from "./dream-scheduler.ts";
import { appendDailyNote, buildMemoryPrelude, type MemoryStorage } from "./memory.ts";
import { buildSystemPrompt } from "./prompt.ts";
import type { ChatSendParams, ClientRequest, ConversationSnapshot, ServerEvent, StateView, WireImage } from "./protocol.ts";
import {
	buildContextMessages,
	estimateTokens,
	historyView,
	type SessionEntry,
} from "./session.ts";
import { isProviderId } from "./provider-config.ts";
import { PiSessions } from "./pi-sessions.ts";
import { handleSlashCommand } from "./slash-commands.ts";
import { StreamBuffer } from "./stream-buffer.ts";
import { ComputerTurnRunner } from "./computer-use/turn-runner.ts";
import type { TurnOwner } from "./computer-use/types.ts";
import { dirname, join } from "node:path";

export interface Client extends TurnOwner {
	send(message: string): void;
}

export class Gateway {
	get isBusy(): boolean { return this.turnController !== null || this.switchingSession || this.switchingBackend; }
	private switchingSession = false;
	private switchingBackend = false;
	private entries: SessionEntry[];
	private sessions: PiSessions;
	private clients = new Set<Client>();
	private turnController: AbortController | null = null;
	private activeTurnId: string | null = null;
	private auth: AuthController;
	private dreams: DreamScheduler;
	private computerTurns: ComputerTurnRunner;
	private controller: Client | null = null;

	constructor(
		private models: LinyRuntime,
		public config: LinyConfig,
		private sessionPath: string,
		private storage?: { memory: MemoryStorage; configPath: string },
	) {
		this.sessions = new PiSessions(sessionPath);
		this.entries = this.sessions.entries();
		this.restoreSessionSettings();
		this.auth = new AuthController(models, this.emit);
		this.dreams = new DreamScheduler(models, () => this.config, this.emit, storage?.memory);
		this.computerTurns = new ComputerTurnRunner(models, { workflowPath: join(dirname(sessionPath), "computer-workflows.json"), backend: config.computerBackend });
	}

	stop(): void {
		this.turnController?.abort();
		if (this.activeTurnId) this.computerTurns.abort(this.activeTurnId);
		void this.computerTurns.close();
		this.auth.stop();
		this.dreams.stop();
	}

	addClient(client: Client): void {
		this.clients.add(client);
		if (!this.controller) this.controller = client;
	}

	removeClient(client: Client): void {
		this.clients.delete(client);
		if (this.clients.size === 0) void this.computerTurns.close();
		if (this.controller === client) {
			this.turnController?.abort();
			if (this.activeTurnId) this.computerTurns.abort(this.activeTurnId);
			this.controller = this.clients.values().next().value ?? null;
		}
	}

	emit = (event: ServerEvent): void => {
		const frame = JSON.stringify({ type: "event", ...event });
		for (const client of this.clients) client.send(frame);
	};

	async handleRequest(client: Client, request: ClientRequest): Promise<unknown> {
		switch (request.method) {
			case "ping":
				return { pong: true };
			case "state.get":
				return this.stateView();
			case "history.get":
				return historyView(this.sessions.transcript());
			case "session.snapshot":
				return this.conversationSnapshot();
			case "session.list":
				return this.sessions.list();
			case "session.resume":
				this.requireController(client);
				if (this.isBusy) throw new Error("turn already running");
				this.switchingSession = true;
				try { await this.sessions.resume(request.params.id); } finally { this.switchingSession = false; }
				this.entries = this.sessions.entries();
				this.restoreSessionSettings();
				this.emit({ event: "session.reset", snapshot: this.conversationSnapshot() });
				return { ok: true };
			case "chat.send":
				this.requireController(client);
				await this.enqueueTurn(request.params, client);
				return { accepted: true };
			case "chat.abort":
				this.requireController(client);
				if (this.activeTurnId) this.computerTurns.abort(this.activeTurnId);
				this.turnController?.abort();
				return { aborted: true };
			case "session.reset":
				this.requireController(client);
				this.resetSession();
				return { ok: true };
			case "auth.login":
				this.requireController(client);
				await this.auth.login(request.params);
				return { started: true };
			case "auth.logout":
				this.requireController(client);
				await this.auth.logout(request.params.provider);
				return { ok: true };
			case "config.set":
				this.requireController(client);
				if (this.switchingBackend) throw new Error("Computer-use backend is changing.");
				if (request.params.computerBackend && this.isBusy) throw new Error("Finish or stop the current turn before changing computer use.");
				if (request.params.selection) {
					const exact = this.models.getModel(
						runtimeProviderId(request.params.selection.provider),
						request.params.selection.model,
					);
					if (!exact) throw new Error("model is not available for this provider");
				}
				this.switchingBackend = true;
				try {
					const previous = this.config.computerBackend;
					if (request.params.computerBackend) await this.computerTurns.setBackend(request.params.computerBackend);
					try {
						this.config = updateConfig({
							...this.config,
							...(request.params.selection ?? {}),
							...(request.params.thinking ? { thinking: request.params.thinking } : {}),
							...(request.params.computerBackend ? { computerBackend: request.params.computerBackend } : {}),
						}, this.storage?.configPath);
					} catch (error) {
						await this.computerTurns.setBackend(previous);
						throw error;
					}
					return { provider: this.config.provider, model: this.config.model, thinking: this.config.thinking, computerBackend: this.config.computerBackend };
				} finally {
					this.switchingBackend = false;
				}
		}
	}

	private requireController(client: Client): void {
		if (client !== this.controller) throw new Error("This Liny connection is read-only.");
	}

	private emitTo(client: Client, event: ServerEvent): void {
		client.send(JSON.stringify({ type: "event", ...event }));
	}

	async initialStateEvent(): Promise<ServerEvent> {
		const auth = await this.auth.state(this.config.provider);
		return { event: "auth.state", provider: this.config.provider, ...auth };
	}

	private restoreSessionSettings(): void {
		const { model, thinkingLevel } = this.sessions.settings();
		if (!model || !isProviderId(model.provider) || model.provider === "liny") return;
		this.config = { ...this.config, provider: model.provider, model: model.modelId,
			...(isThinkingLevel(thinkingLevel) ? { thinking: thinkingLevel } : {}),
		};
	}

	private conversationSnapshot(): ConversationSnapshot {
		return { ...historyView(this.sessions.transcript()), id: this.sessions.id,
			provider: this.config.provider, model: this.config.model, thinking: this.config.thinking };
	}

	private resetSession(): void {
		if (this.isBusy) throw new Error("turn already running");
		this.sessions.create();
		this.entries = [];
		this.emit({ event: "session.reset", snapshot: this.conversationSnapshot() });
	}

	private async enqueueTurn(params: ChatSendParams, owner: Client): Promise<void> {
		if (!params.text.trim() && params.images.length === 0) throw new Error("empty message");
		if (this.isBusy) throw new Error("turn already running");

		const handledCommand = await handleSlashCommand(params.text, {
			reset: async () => this.resetSession(),
			remember: (fact) => {
				appendDailyNote(`REMEMBER: ${fact}`, this.storage?.memory);
				this.emit({ event: "notice", message: `Remembered: ${fact}` });
			},
			showMemory: () => {
				this.emit({ event: "turn.started" });
				this.emit({ event: "delta", text: buildMemoryPrelude(2_000, this.storage?.memory) || "No memories yet." });
				this.emit({ event: "turn.done" });
			},
			reportUnknown: (name) => this.emit({ event: "turn.error", message: `unknown command: /${name}` }),
		});
		if (handledCommand) return;
		if (this.isBusy) throw new Error("turn already running");

		const currentUserMessage = userMessage(params.text, params.images);
		const contextMessages = [...this.sessions.context(), currentUserMessage];
		this.sessions.selection(runtimeProviderId(this.config.provider), this.config.model, this.config.thinking);
		const userEntry: SessionEntry = { type: "message", message: currentUserMessage };
		this.sessions.append(currentUserMessage);
		this.entries.push(userEntry);

		const controller = new AbortController();
		this.turnController = controller;
		const turnId = crypto.randomUUID();
		this.activeTurnId = turnId;
		this.emit({ event: "turn.started" });

		const streamBuffer = new StreamBuffer((text) => this.emit({ event: "delta", text }));

		try {
			const model = resolveModel(this.models, { provider: this.config.provider, model: this.config.model });
			const system = buildSystemPrompt(
				Intl.DateTimeFormat().resolvedOptions().timeZone,
				this.config.memoryBootstrapMaxChars,
				this.storage?.memory,
			);
			const outcome = await this.computerTurns.run(
				{
					turnId,
					tools: params.tools,
					owner,
					model,
					thinking: this.config.thinking,
					systemPrompt: system,
					messages: contextMessages,
					signal: controller.signal,
				},
				{
					assistantDelta: (delta) => streamBuffer.push(delta),
					appendMessage: (message) => {
						const entry: SessionEntry = { type: "message", message };
						this.sessions.append(message);
						this.entries.push(entry);
					},
					activity: (activity) => this.emitTo(owner, { event: "tool.activity", ...activity }),
				},
			);
			streamBuffer.flush();

			const usage = outcome.usage;
			this.emit({ event: "turn.done", usage });

			if (
				shouldCompact(estimateTokens(this.entries), model, this.config.compactionReserveTokens)
			) {
				await this.runCompaction(model);
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				streamBuffer.flush();
				this.emit({ event: "turn.done" });
			} else {
				this.emit({ event: "turn.error", message: error instanceof Error ? error.message : String(error) });
			}
		} finally {
			if (this.turnController === controller) this.turnController = null;
			if (this.activeTurnId === turnId) this.activeTurnId = null;
		}
	}

	private async runCompaction(model: Model<Api>): Promise<void> {
		if (buildContextMessages(this.entries).length < 4) return;
		try {
			const complete = async (system: string, messages: Message[]): Promise<string> => {
				const response = await this.models.completeSimple(model, { systemPrompt: system, messages });
				return completedAssistantText(response);
			};
			const usableContext = Math.max(model.contextWindow - this.config.compactionReserveTokens, 4_000);
			const recentTail = Math.min(this.config.keepRecentTokens, Math.floor(usableContext / 2));
			const compacted = await compactEntries(this.entries, complete, recentTail);
			if (compacted === this.entries) return;
			const summary = compacted[0];
			const firstKept = compacted[1];
			if (summary?.type !== "compaction" || firstKept?.type !== "message") return;
			this.sessions.compact(summary.summary, firstKept.message, estimateTokens(this.entries));
			this.entries = this.sessions.entries();
			this.emit({ event: "compacted" });
		} catch (error) {
			this.emit({
				event: "turn.error",
				message: `compaction failed, continuing with full history: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private async stateView(): Promise<StateView> {
		const providerDefinitions = listProviders(this.models);
		const providers = await Promise.all(providerDefinitions.map(async (provider) => {
			const auth = await this.auth.state(provider.id);
			return { ...provider, loggedIn: auth.loggedIn, ...(auth.source ? { authSource: auth.source } : {}) };
		}));
		const auth = providers.find((provider) => provider.id === this.config.provider);
		return {
			loggedIn: auth?.loggedIn ?? false,
			authSource: auth?.authSource,
			provider: this.config.provider,
			model: this.config.model,
			providers,
			models: listModels(this.models),
			thinking: this.config.thinking,
			sessionTurns: this.entries.length,
			computerBackend: this.config.computerBackend,
		};
	}
}

function userMessage(text: string, images: WireImage[]): UserMessage {
	const trimmedText = text.trim();
	if (images.length === 0) return { role: "user", content: trimmedText, timestamp: Date.now() };
	return {
		role: "user",
		content: [
			...(trimmedText ? [{ type: "text", text: trimmedText } satisfies Message["content"][number]] : []),
			...images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }) as const),
		],
		timestamp: Date.now(),
	};
}
