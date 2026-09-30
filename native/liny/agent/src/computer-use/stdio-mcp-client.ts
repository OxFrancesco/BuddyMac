import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface McpContent {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
	[key: string]: unknown;
}

export interface McpToolResult {
	content: McpContent[];
	isError: boolean;
	structuredContent?: unknown;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

export class StdioMcpClient {
	private child: ChildProcessWithoutNullStreams | null = null;
	private buffer = "";
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private ready: Promise<void> | null = null;
	private generation = 0;
	private stderr = "";
	private closing: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(private readonly binary: string, private readonly args: string[],
		private readonly label: string, private readonly timeoutMs = 90_000,
		private readonly environment: NodeJS.ProcessEnv = process.env) {}

	private start(): void {
		const generation = ++this.generation;
		const child = spawn(this.binary, this.args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: this.environment,
		});
		this.child = child;
		this.buffer = "";
		this.stderr = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.onStdout(chunk, generation));
		child.stderr.on("data", (chunk: Buffer) => {
			if (generation !== this.generation) return;
			this.stderr = (this.stderr + chunk.toString()).slice(-8_192);
		});
		child.on("error", (error) => this.failGeneration(generation, error));
		child.on("close", (code) => this.failGeneration(generation, new Error(`${this.label} exited (${code ?? "unknown"}).`)));
	}

	private onStdout(chunk: string, generation: number): void {
		if (generation !== this.generation) return;
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) return;
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			let message: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			if (message.id === undefined) continue;
			const pending = this.pending.get(message.id);
			if (!pending) continue;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
			else pending.resolve(message.result);
		}
	}

	private failGeneration(generation: number, error: Error): void {
		if (generation !== this.generation) return;
		this.child = null;
		this.ready = null;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}

	private request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
		if (this.disposed) return Promise.reject(new Error(`${this.label} client is closed.`));
		if (!this.child) this.start();
		const child = this.child!;
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${this.label} ${method} timed out. Execution was stopped; already-dispatched actions must not be repeated without inspection.`));
				void this.abortAndRecycle();
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	async ensure(): Promise<void> {
		await this.closing;
		if (this.disposed) throw new Error(`${this.label} client is closed.`);
		if (this.ready) return this.ready;
		this.ready = (async () => {
			if (!this.child) this.start();
			await this.request("initialize", {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "Liny", version: "0.1.0" },
			}, 15_000);
			this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
		})();
		try {
			await this.ready;
		} catch (error) {
			this.ready = null;
			throw error;
		}
	}

	async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpToolResult> {
		await this.ensure();
		if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
		const call = this.request("tools/call", { name, arguments: args ?? {} }).then(parseToolResult);
		if (!signal) {
			const result = await call;
			return result;
		}
		return await new Promise<McpToolResult>((resolve, reject) => {
			const onAbort = () => {
				void this.abortAndRecycle();
				reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			call.then(
				(result) => {
					signal.removeEventListener("abort", onAbort);
					resolve(result);
				},
				(error) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				},
			);
		});
	}

	async turnEnded(): Promise<void> {
		if (!this.child) return;
		this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/turn-ended", params: { source: "liny" } })}\n`);
	}

	async abortAndRecycle(): Promise<void> {
		const child = this.child;
		this.generation += 1;
		this.child = null;
		this.ready = null;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
		}
		this.pending.clear();
		if (child && child.exitCode === null && child.signalCode === null) {
			this.closing = new Promise<void>((resolve) => {
				const deadline = setTimeout(() => { child.kill("SIGKILL"); }, 7_000);
				deadline.unref();
				child.once("close", () => { clearTimeout(deadline); resolve(); });
				child.stdin.end();
				child.kill("SIGTERM");
			});
		}
		await this.closing;
	}

	async close(): Promise<void> {
		this.disposed = true;
		await this.abortAndRecycle();
	}

	diagnostic(): string {
		return this.stderr;
	}
}

function parseToolResult(value: unknown): McpToolResult {
	if (!value || typeof value !== "object" || !("content" in value) || !Array.isArray(value.content)) {
		throw new Error("Invalid MCP tool response");
	}
	const content: McpContent[] = value.content.map((block: unknown) => {
		if (!block || typeof block !== "object" || !("type" in block)) throw new Error("Invalid MCP content block");
		if (block.type === "text" && "text" in block && typeof block.text === "string") return { type: "text", text: block.text };
		if (block.type === "image" && "data" in block && typeof block.data === "string" && "mimeType" in block && typeof block.mimeType === "string") {
			return { type: "image", data: block.data, mimeType: block.mimeType };
		}
		throw new Error("Unsupported MCP content block");
	});
	return { content, isError: "isError" in value && value.isError === true,
		...("structuredContent" in value ? { structuredContent: value.structuredContent } : {}) };
}
