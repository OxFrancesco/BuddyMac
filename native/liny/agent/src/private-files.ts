import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

let temporaryFileCounter = 0;

export function ensurePrivateDirectory(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	chmodSync(path, 0o700);
}

export function appendPrivateFile(path: string, content: string): void {
	ensurePrivateDirectory(dirname(path));
	appendFileSync(path, content, { mode: 0o600 });
	chmodSync(path, 0o600);
}

export function writePrivateFile(path: string, content: string): void {
	ensurePrivateDirectory(dirname(path));
	const temporaryPath = `${path}.${process.pid}.${temporaryFileCounter++}.tmp`;
	try {
		writeFileSync(temporaryPath, content, { mode: 0o600 });
		renameSync(temporaryPath, path);
		chmodSync(path, 0o600);
	} finally {
		if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
	}
}
