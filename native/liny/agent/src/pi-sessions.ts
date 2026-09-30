import { existsSync, readFileSync, chmodSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { SessionManager, convertToLlm } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { ensurePrivateDirectory, writePrivateFile } from "./private-files.ts";
import { loadSession, type SessionEntry } from "./session.ts";

export class PiSessions {
	private manager: SessionManager;
	private directory: string;
	private pointer: string;

	constructor(legacyPath: string) {
		this.directory = join(dirname(legacyPath), "pi-sessions");
		this.pointer = join(this.directory, "current.json");
		ensurePrivateDirectory(this.directory);
		let current: string | undefined;
		try {
			const stored = JSON.parse(readFileSync(this.pointer, "utf8"));
			if (typeof stored.file === "string" && basename(stored.file) === stored.file && stored.file.endsWith(".jsonl")) {
				const file = join(this.directory, stored.file);
				if (existsSync(file)) current = file;
			}
		} catch {}
		this.manager = current ? SessionManager.open(current, this.directory) : this.createManager();
		if (!current && !existsSync(this.pointer)) {
			for (const entry of loadSession(legacyPath)) {
				if (entry.type === "message") this.manager.appendMessage(entry.message);
				else this.manager.appendCompaction(entry.summary, "", 0);
			}
		}
		this.savePointer();
	}

	private createManager(): SessionManager {
		const manager = SessionManager.create(process.cwd(), this.directory);
		const file = manager.getSessionFile()!;
		// Reserve the Pi header so interrupted first turns and empty chats survive restart.
		writePrivateFile(file, `${JSON.stringify(manager.getHeader())}\n`);
		return SessionManager.open(file, this.directory);
	}

	private savePointer(): void {
		const file = this.manager.getSessionFile()!;
		chmodSync(file, 0o600);
		writePrivateFile(this.pointer, JSON.stringify({ file: basename(file) }));
	}

	settings() {
		const { model, thinkingLevel } = this.manager.buildSessionContext();
		return { model, thinkingLevel };
	}
	get id(): string { return this.manager.getSessionId(); }
	context(): Message[] { return convertToLlm(this.manager.buildSessionContext().messages); }
	entries(): SessionEntry[] { return this.context().map(message => ({ type: "message", message })); }
	transcript(): SessionEntry[] {
		return this.manager.getBranch().flatMap(entry => entry.type === "message" &&
			(entry.message.role === "user" || entry.message.role === "assistant" || entry.message.role === "toolResult")
			? [{ type: "message" as const, message: entry.message }] : []);
	}
	append(message: Message): void { this.manager.appendMessage(message); }
	selection(provider: string, model: string, thinking: string): void {
		const context = this.manager.buildSessionContext();
		if (context.model?.provider !== provider || context.model.modelId !== model) this.manager.appendModelChange(provider, model);
		if (context.thinkingLevel !== thinking) this.manager.appendThinkingLevelChange(thinking);
	}
	create(): void { this.manager = this.createManager(); this.savePointer(); }
	async list() {
		const sessions = await SessionManager.listAll(this.directory);
		return { currentId: this.id, sessions: sessions.map(session => ({
			id: session.id, title: session.name || (session.firstMessage === "(no messages)" ? "New conversation" : session.firstMessage.replaceAll("[Earlier image omitted after processing.]", "").trim().slice(0, 100) || "Image conversation"),
			updatedAt: session.modified.getTime(),
		})) };
	}
	async resume(id: string): Promise<void> {
		const session = (await SessionManager.listAll(this.directory)).find(session => session.id === id);
		if (!session) throw new Error("Conversation not found in this account.");
		this.manager = SessionManager.open(session.path, this.directory);
		this.savePointer();
	}
	compact(summary: string, firstKept: Message, tokensBefore: number): void {
		const entry = this.manager.getBranch().find(entry => entry.type === "message" && entry.message === firstKept);
		if (!entry) throw new Error("Compaction boundary is not in the current Pi session.");
		this.manager.appendCompaction(summary, entry.id, tokensBefore);
	}
}
