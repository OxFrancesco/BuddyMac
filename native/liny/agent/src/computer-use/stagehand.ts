import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { StdioMcpClient } from "./stdio-mcp-client.ts";
import { agentResult } from "./tools.ts";
import type { ComputerUseToolSet, ComputerToolName, ReadComputerToolName } from "./types.ts";

export class StagehandMcpClient extends StdioMcpClient {
	constructor() {
		const packaged = fileURLToPath(new URL("./stagehand.js", import.meta.url));
		const source = fileURLToPath(new URL("../../vendor/stagehand/src/facade/stdio-server.ts", import.meta.url));
		super(process.execPath, [existsSync(packaged) ? packaged : source], "Stagehand", 90_000, {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			TMPDIR: process.env.TMPDIR,
			STAGEHAND_BROWSER: "local",
			...(existsSync(packaged) ? { STAGEHAND_EXTENSION_DIRECTORY_PATH: fileURLToPath(new URL("./stagehand-extension/", import.meta.url)) } : {}),
		});
	}

	override async turnEnded(): Promise<void> {}
}

const id = Type.String({ minLength: 1, description: "ID from the latest Stagehand snapshot." });
const action = Type.Union([
	Type.Object({ op: Type.Literal("click"), id }),
	Type.Object({ op: Type.Literal("hover"), id }),
	Type.Object({ op: Type.Literal("fill"), id, value: Type.String() }),
	Type.Object({ op: Type.Literal("type"), id, text: Type.String(), delay: Type.Optional(Type.Number({ minimum: 0 })) }),
	Type.Object({ op: Type.Literal("press"), id, key: Type.String() }),
	Type.Object({ op: Type.Literal("select"), id, values: Type.Union([Type.String(), Type.Array(Type.String(), { minItems: 1 })]) }),
]);

const definitions = [
	{ name: "stagehand_run", label: "Run browser actions", description: "Run JavaScript against a persistent Playwright-shaped page, context, and browser, or actions using IDs from the latest snapshot. Provide exactly one of code or actions. Example code: await page.goto('https://example.com'); return await page.title();. Batch dependent steps using code and local conditions. Actions use op and id, not kind or ref.", parameters: Type.Object({ code: Type.Optional(Type.String({ minLength: 1 })), actions: Type.Optional(Type.Array(action, { minItems: 1, maxItems: 30 })) }, { additionalProperties: false }) },
	{ name: "stagehand_snapshot", label: "Inspect browser", description: "Read the active browser page's accessibility tree and hydrate its IDs for subsequent actions. Refresh after navigation or a stale ID error.", parameters: Type.Object({ includeIframes: Type.Optional(Type.Boolean()) }, { additionalProperties: false }) },
	{ name: "stagehand_screenshot", label: "Capture browser", description: "Capture the active browser page for visual inspection.", parameters: Type.Object({ fullPage: Type.Optional(Type.Boolean()), type: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")])), quality: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })) }, { additionalProperties: false }) },
] as const satisfies readonly { name: ComputerToolName; label: string; description: string; parameters: TSchema }[];

export function createStagehandTools(client: Pick<StdioMcpClient, "callTool">): ComputerUseToolSet {
	return {
		tools: definitions.map((definition): AgentTool<TSchema> => ({
			...definition,
			executionMode: "sequential",
			async execute(_id, params: unknown, signal) {
				if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
				if (!Check(definition.parameters, params)) throw new Error(`Invalid ${definition.name} arguments`);
				if (definition.name === "stagehand_run" && (("code" in params) === ("actions" in params))) {
					throw new Error("Provide exactly one of code or actions");
				}
				const result = await client.callTool(definition.name.replace("stagehand_", ""), params, signal);
				return agentResult(definition.name, result, ["stagehand-browser"], false);
			},
		})),
		isKnown(name): name is ComputerToolName { return definitions.some((definition) => definition.name === name); },
		isReadOnly(name): name is ReadComputerToolName { return name === "stagehand_snapshot" || name === "stagehand_screenshot"; },
	};
}

export const STAGEHAND_PROMPT = `
The selected computer-use backend is Stagehand. You control a separate local Chrome session through stagehand_run, stagehand_snapshot, and stagehand_screenshot. These tools cannot control native Mac apps. If the task requires a native app, tell the user to select Open Computer Use in Settings > General > Computer use.
Use the user's selected model for reasoning. The browser tools need no separate model or API key. Do not call Stagehand AI methods such as act, extract, or observe.
The browser session persists across tool calls and turns until the user switches backends, disconnects the account, stops a task, or quits Liny. Old browser state and snapshot IDs in conversation history may no longer exist; inspect current state before acting.
Navigate with await page.goto(url). For a new browsing task preserve existing pages by creating a new page with await context.newPage(), then navigating that page. Stay on the task's page. Never inspect unrelated tabs or private content.
After observing a snapshot, prefer its IDs for simple actions. For batches, use the Playwright-shaped API, with page.getByRole, getByText, or getByPlaceholder and normal JavaScript control flow. A textbox's displayed snapshot label may be its placeholder rather than its accessible name. Use getByPlaceholder in that case. Use bounded timeouts and inspect after a failure; earlier actions may have completed and must not be blindly repeated.
Only use locators grounded in observed state. Verify the final result with a snapshot or screenshot. Keep a single persistent browser session and reuse its current page between calls. Tool context retains only the latest browser screenshot.
Stay within the user's requested scope. Do not infer destructive, financial, legal, credential, security-setting, upload, or sensitive-data actions from an ambiguous request.
`;
