import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function createLock(path: string): boolean {
	try {
		const descriptor = openSync(path, "wx", 0o600);
		try {
			writeFileSync(descriptor, String(process.pid));
		} finally {
			closeSync(descriptor);
		}
		return true;
	} catch (error) {
		if (errorCode(error) === "EEXIST") return false;
		throw error;
	}
}

export function acquireLock(path: string): boolean {
	if (createLock(path)) return true;

	try {
		const pid = Number(readFileSync(path, "utf8"));
		if (Number.isInteger(pid) && pid > 0) process.kill(pid, 0);
		return false;
	} catch (error) {
		const code = errorCode(error);
		if (code !== "ENOENT" && code !== "ESRCH") return false;
	}

	try {
		unlinkSync(path);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") return false;
	}
	return createLock(path);
}

export function releaseLock(path: string): void {
	try {
		const pid = Number(readFileSync(path, "utf8"));
		if (pid === process.pid) unlinkSync(path);
	} catch {
		// The lock may already be gone after a crash or manual cleanup.
	}
}
