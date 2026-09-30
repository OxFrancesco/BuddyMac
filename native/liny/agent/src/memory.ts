import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LinyConfig } from "./config.ts";
import { DAILY_DIR, DREAM_STATE_FILE, MEMORY_FILE, daysAgoStamp, todayStamp } from "./paths.ts";
import { appendPrivateFile, ensurePrivateDirectory, writePrivateFile } from "./private-files.ts";

export interface MemoryStorage {
	dailyDirectory: string;
	memoryFile: string;
	dreamStateFile: string;
}

const DEFAULT_STORAGE: MemoryStorage = {
	dailyDirectory: DAILY_DIR,
	memoryFile: MEMORY_FILE,
	dreamStateFile: DREAM_STATE_FILE,
};

export function readMemoryFile(path: string, capChars: number): string {
	try {
		const raw = readFileSync(path, "utf8");
		if (raw.length <= capChars) return raw;
		const marker = "\n[truncated]";
		if (capChars <= marker.length) return marker.slice(0, capChars);
		return `${raw.slice(0, capChars - marker.length)}${marker}`;
	} catch {
		return "";
	}
}

export function buildMemoryPrelude(maxTotal: number, storage: MemoryStorage = DEFAULT_STORAGE): string {
	const parts: string[] = [];
	let used = 0;
	const appendSection = (open: string, close: string, path: string, preferredCap: number): void => {
		const separatorLength = parts.length ? 2 : 0;
		const wrapperLength = open.length + close.length + 2;
		const remaining = maxTotal - used - separatorLength - wrapperLength;
		if (remaining <= 0) return;
		const content = readMemoryFile(path, Math.min(preferredCap, remaining));
		if (!content) return;
		const section = `${open}\n${content}\n${close}`;
		parts.push(section);
		used += separatorLength + section.length;
	};

	appendSection("<memory>", "</memory>", storage.memoryFile, 6_000);

	for (const stamp of [todayStamp(), daysAgoStamp(1)]) {
		appendSection(
			`<daily-notes date="${stamp}">`,
			"</daily-notes>",
			join(storage.dailyDirectory, `${stamp}.md`),
			3_000,
		);
	}
	return parts.join("\n\n");
}

export function appendDailyNote(text: string, storage: MemoryStorage = DEFAULT_STORAGE): void {
	ensurePrivateDirectory(storage.dailyDirectory);
	const path = join(storage.dailyDirectory, `${todayStamp()}.md`);
	const prefix = existsSync(path) ? "" : `# ${todayStamp()}\n\n`;
	appendPrivateFile(path, `${prefix}- ${text.trim()}\n`);
}

interface DreamState {
	lastDream?: string;
	lastError?: string;
}

function readDreamState(path: string): DreamState {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof value !== "object" || value === null) return {};
		const state: DreamState = {};
		if ("lastDream" in value && typeof value.lastDream === "string") state.lastDream = value.lastDream;
		if ("lastError" in value && typeof value.lastError === "string") state.lastError = value.lastError;
		return state;
	} catch {
		return {};
	}
}

function writeDreamState(path: string, state: DreamState): void {
	writePrivateFile(path, JSON.stringify(state, null, "\t"));
}

function oldDailyNotes(storage: MemoryStorage, cutoff: string): { path: string; content: string }[] {
	const notes: { path: string; content: string }[] = [];
	for (const file of readdirSync(storage.dailyDirectory)) {
		if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file) || file.slice(0, 10) >= cutoff) continue;
		const path = join(storage.dailyDirectory, file);
		try {
			notes.push({ path, content: readFileSync(path, "utf8") });
		} catch {
			// Keep unreadable files in place so a later run can retry them.
		}
	}
	return notes;
}

export async function runDreaming(
	complete: (system: string, user: string) => Promise<string>,
	config: LinyConfig,
	storage: MemoryStorage = DEFAULT_STORAGE,
	signal?: AbortSignal,
): Promise<{ ran: boolean; reason?: string }> {
	const state = readDreamState(storage.dreamStateFile);
	const now = new Date();
	if (now.getHours() < config.dreamHour) return { ran: false, reason: "too-early" };
	if (state.lastDream === todayStamp()) return { ran: false, reason: "already-ran" };

	ensurePrivateDirectory(storage.dailyDirectory);
	const archiveCandidates = oldDailyNotes(storage, daysAgoStamp(config.dailyNoteRetentionDays));
	const recent = [daysAgoStamp(2), daysAgoStamp(1), todayStamp()].map((stamp) =>
		readMemoryFile(join(storage.dailyDirectory, `${stamp}.md`), 12_000),
	);
	const currentMemory = readMemoryFile(storage.memoryFile, 30_000);
	const archive = archiveCandidates.map((note) => note.content).filter(Boolean).join("\n\n");
	if (!recent.some(Boolean) && !archive) {
		writeDreamState(storage.dreamStateFile, { lastDream: todayStamp() });
		return { ran: false, reason: "no-notes" };
	}

	const merged = await complete(
		DREAM_SYSTEM,
		[
			`Current MEMORY.md:\n<current>\n${currentMemory || "(empty)"}\n</current>`,
			recent.some(Boolean) ? `Recent daily notes:\n${recent.filter(Boolean).join("\n\n---\n\n")}` : "",
			archive ? `Older notes to merge into memory:\n${archive}` : "",
			"Produce the new MEMORY.md.",
		]
			.filter(Boolean)
			.join("\n\n"),
	);

	signal?.throwIfAborted();
	if (!merged.trim()) {
		writeDreamState(storage.dreamStateFile, { ...state, lastError: "empty output" });
		return { ran: false, reason: "empty-output" };
	}

	writePrivateFile(storage.memoryFile, `${merged.trim()}\n`);
	for (const note of archiveCandidates) {
		try {
			unlinkSync(note.path);
		} catch {
			// The merged memory is safe. A leftover note may be merged again tomorrow.
		}
	}
	writeDreamState(storage.dreamStateFile, { lastDream: todayStamp() });
	return { ran: true };
}

const DREAM_SYSTEM = `You maintain Liny's long-term memory.
You will receive the current MEMORY.md and recent daily notes.

Rules:
- Return only the full MEMORY.md content in Markdown.
- Keep it under 400 lines.
- Merge duplicates and remove stale or superseded facts.
- Preserve identity, preferences, projects, commitments, decisions, and dates.
- Keep durable facts from older notes.
- Use short topical sections and one fact per line when practical.`;
