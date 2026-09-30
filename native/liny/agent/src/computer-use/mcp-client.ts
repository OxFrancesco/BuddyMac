import { existsSync } from "node:fs";
import { StdioMcpClient } from "./stdio-mcp-client.ts";
export type { McpContent, McpToolResult } from "./stdio-mcp-client.ts";

export function resolveOcuBinary(environment: NodeJS.ProcessEnv = process.env): string {
 const binary = environment.LINY_OCU_BIN;
 if (binary && existsSync(binary)) return binary;
 throw new Error("BuddyMac's native computer helper is missing. Rebuild and reinstall BuddyMac.");
}

export class OcuMcpClient extends StdioMcpClient {
	constructor(binary = resolveOcuBinary(), timeoutMs = 90_000, environment: NodeJS.ProcessEnv = process.env) {
		super(binary, ["mcp"], "Open Computer Use", timeoutMs, {
			// The native proxy enables its parent-PID socket and death monitor only for liny: namespaces.
			...environment, OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE: `liny:buddymac:${binary}`,
			// The upstream overlay loads an unbundled build-machine image synchronously before dispatching clicks.
			OPEN_COMPUTER_USE_VISUAL_CURSOR: "0",
		});
	}
}
