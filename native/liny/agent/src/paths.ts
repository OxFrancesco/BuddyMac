import { homedir } from "node:os";
import { join } from "node:path";

export const LINY_DIR = process.env.LINY_HOME ?? join(homedir(), ".liny");
export const SESSION_FILE = join(LINY_DIR, "session", "main.jsonl");
export const MEMORY_DIR = join(LINY_DIR, "memory");
export const MEMORY_FILE = join(MEMORY_DIR, "MEMORY.md");
export const DAILY_DIR = join(MEMORY_DIR, "daily");
export const AUTH_FILE = join(LINY_DIR, "auth.json");
export const CONFIG_FILE = join(LINY_DIR, "config.json");
export const LOCK_FILE = join(LINY_DIR, "linyd.lock");
export const GATEWAY_TOKEN_FILE = join(LINY_DIR, "gateway-token");
export const DREAM_STATE_FILE = join(LINY_DIR, "dream-state.json");

export function todayStamp(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysAgoStamp(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
