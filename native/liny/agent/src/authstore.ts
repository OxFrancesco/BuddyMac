import { readFileSync } from "node:fs";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { writePrivateFile } from "./private-files.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): boolean {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isCredential(value: unknown): value is Credential {
	if (!isRecord(value)) return false;
	if (value.type === "api_key") {
		return (
			(value.key === undefined || typeof value.key === "string") &&
			(value.env === undefined || isStringRecord(value.env))
		);
	}
	return (
		value.type === "oauth" &&
		typeof value.refresh === "string" &&
		typeof value.access === "string" &&
		typeof value.expires === "number"
	);
}

export class FileCredentialStore implements CredentialStore {
	private credentials = new Map<string, Credential>();
	private mutationChain: Promise<void> = Promise.resolve();

	constructor(private path: string) {
		try {
			const value: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!isRecord(value)) return;
			for (const [providerId, credential] of Object.entries(value)) {
				if (isCredential(credential)) this.credentials.set(providerId, credential);
			}
		} catch {
			// Start signed out when the credential file is absent or unreadable.
		}
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		await this.mutationChain;
		return this.credentials.get(providerId);
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		await this.mutationChain;
		return [...this.credentials].map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	async modify(
		providerId: string,
		update: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		let result: Credential | undefined;
		const mutation = this.mutationChain.then(async () => {
			options?.signal?.throwIfAborted();
			result = await update(this.credentials.get(providerId));
			if (result === undefined) this.credentials.delete(providerId);
			else this.credentials.set(providerId, result);
			this.flush();
		});
		this.mutationChain = mutation.catch(() => {});
		await mutation;
		return result;
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		const mutation = this.mutationChain.then(() => {
			options?.signal?.throwIfAborted();
			this.credentials.delete(providerId);
			this.flush();
		});
		this.mutationChain = mutation.catch(() => {});
		await mutation;
	}

	private flush(): void {
		const durableCredentials = [...this.credentials].filter(([, credential]) => credential.type !== "api_key");
		writePrivateFile(this.path, JSON.stringify(Object.fromEntries(durableCredentials), null, "\t"));
	}
}
