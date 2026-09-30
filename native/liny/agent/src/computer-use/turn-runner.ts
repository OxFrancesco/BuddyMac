import { runAgentLoopContinue, type AgentEvent } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Context, Message, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { usageOf, type LinyRuntime } from "../agent-runtime.ts";
import { fastStreamOptions } from "../fast-stream.ts";
import type { ComputerBackend } from "../config.ts";
import type { StdioMcpClient } from "./stdio-mcp-client.ts";
import { resolveSystemDefaultBrowser } from "./default-browser.ts";
import { OcuMcpClient } from "./mcp-client.ts";
import { createComputerUseTools } from "./tools.ts";
import { boundComputerScreenshots } from "./context.ts";
import { ComputerWorkflows } from "./workflows.ts";
import type {
	ComputerActivity,
	ComputerToolName,
	ComputerTurnInput,
	ComputerTurnOutcome,
	ComputerTurnSink,
} from "./types.ts";

const COMPUTER_USE_PROMPT = `
Inspect and control macOS apps with the ocu_* tools. Browser actions always use the macOS default browser and its existing user session. Stagehand cannot attach to that session in this integration, so native controls are used automatically even when Stagehand is selected. Never ask the user to switch backends. Stagehand tools from earlier conversation history are unavailable. Never launch a separate browser, profile, or private/incognito session.
Computer use is in YOLO mode: execute actions immediately without asking for confirmation or waiting for approval.
When the user names the app and the action has all required arguments, call the action tool directly. Call ocu_list_apps only when the target app is unknown. Call ocu_get_app_state only when you need an element index, visual context, or missing state; prefer element_index over coordinates when inspection was needed.
When two or more actions can be planned from the current context and later actions do not depend on observing earlier results, use one ocu_run_actions call containing the full ordered sequence.
Use native plans with semantic targets and local assert, wait_for, or when steps when later actions depend on simple UI conditions. Wait for the actual focused field or expected value before proceeding. Finish plans with an outcome check. Failed conditions stop execution; inspect the returned state before replanning and never blindly repeat actions after a timeout.
Prefer ocu_query_state for one control or ocu_get_app_state with screenshot=false when text is sufficient. Native plans return final observations; do not request the same state again without a reason. Tool context retains the latest screenshot and one explicitly retained comparison per app, capped at eight tool images. Mark a screenshot retain_for_comparison=true before changing a view you need to compare. User attachments are retained.
To replace the entire content of a settable text field, use ocu_set_value or a native set_value action with its semantic target, followed by a value assertion. The native type_text fallback appends to editable accessibility values and does not honor a select-all replacement; do not use that sequence for replacements.
For repeated tasks, check ocu_list_workflows and use a matching ocu_run_workflow with the user's current parameters. Save a successful sequence only with initial and final conditions, semantic targets, and all entered text/value fields parameterized. Do not save credentials or unexecuted branches. A saved workflow still checks its conditions on every run.
For all browser actions, use the default browser identified below by macOS, targeting its bundle identifier. Do not infer the browser from a misspelled or dictated name, old messages, or a saved workflow. Never use Chrome or another browser as a fallback. Preserve the user's signed-in profile. If a workflow targets a different browser, use the native tools on the current default browser instead. Treat requests to open a site, page, link, or tab as preserve-current-tab by default: create a new tab first, then navigate there. Reuse or replace the current tab only when the user explicitly asks you to.
Use the fewest tool calls that fully complete the request. Do not re-inspect after a successful action unless its result is unclear.
Stay within the user's requested scope. Never inspect password managers or unrelated private content. Do not infer destructive, financial, legal, credential, security-setting, upload, or sensitive-data actions from an ambiguous request; execute them without a second confirmation only when the user explicitly requested them.
`;

function isMessage(value: unknown): value is Message {
	return !!value && typeof value === "object" && "role" in value;
}

export class ComputerTurnRunner {
	private client: StdioMcpClient | null;
	private backend: ComputerBackend;
	private activeTurnId: string | null = null;
	private readonly workflows: ComputerWorkflows;
	private readonly createClient: () => StdioMcpClient;

	constructor(private readonly models: LinyRuntime, options?: { client?: StdioMcpClient; workflowPath?: string; backend?: ComputerBackend; createClient?: () => StdioMcpClient }) {
		this.client = options?.client ?? null;
		this.createClient = options?.createClient ?? (() => new OcuMcpClient());
		this.backend = options?.backend ?? "ocu";
		this.workflows = new ComputerWorkflows(options?.workflowPath);
	}

	async warm(): Promise<void> {
		await this.getClient().ensure();
	}

	abort(turnId: string): void {
		if (this.activeTurnId === turnId) void this.client?.abortAndRecycle();
	}

	async close(): Promise<void> {
		const client = this.client;
		this.client = null;
		await client?.close();
	}

	private getClient(): StdioMcpClient {
		return this.client ??= this.createClient();
	}

	async setBackend(backend: ComputerBackend): Promise<void> {
		if (backend === this.backend) return;
		if (this.activeTurnId) throw new Error("Finish or stop the current turn before changing computer use.");
		await this.close();
		this.backend = backend;
	}

	async run(input: ComputerTurnInput, sink: ComputerTurnSink): Promise<ComputerTurnOutcome> {
		if (this.activeTurnId) throw new Error("computer turn already running");
		const toolSet = createComputerUseTools({ callTool: (name, args, signal) => this.getClient().callTool(name, args, signal) }, this.workflows);
		this.activeTurnId = input.turnId;
		let usage = { input: 0, output: 0, total: 0 };

		const emit = async (event: AgentEvent) => {
			switch (event.type) {
				case "message_update":
					if (event.assistantMessageEvent.type === "text_delta") sink.assistantDelta(event.assistantMessageEvent.delta);
					break;
				case "message_end":
					if (!isMessage(event.message) || event.message.role === "user") break;
					sink.appendMessage(event.message);
					if (event.message.role === "assistant") {
						const next = usageOf(event.message as AssistantMessage);
						usage = { input: usage.input + next.input, output: usage.output + next.output, total: usage.total + next.total };
					}
					break;
				case "tool_execution_start": {
					if (!toolSet.isKnown(event.toolName)) break;
					const phase = toolSet.isReadOnly(event.toolName) ? "inspecting" : "running";
					sink.activity(this.activity(input.turnId, event.toolCallId, event.toolName, phase));
					break;
				}
				case "tool_execution_end":
					if (!toolSet.isKnown(event.toolName)) break;
					sink.activity(this.activity(input.turnId, event.toolCallId, event.toolName, event.isError ? "failed" : "succeeded"));
					break;
			}
		};

		try {
			const browser = input.tools === "none" ? null : await resolveSystemDefaultBrowser(input.signal);
			const stream = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
				model.api === "openai-codex-responses"
					? this.models.stream(
						model as Model<"openai-codex-responses">,
						context,
						fastStreamOptions(options),
					)
					: this.models.streamSimple(model, context, options);
			const messages = await runAgentLoopContinue(
				{
					systemPrompt: browser ? `${input.systemPrompt}\n${COMPUTER_USE_PROMPT}\nCurrent macOS default browser: ${JSON.stringify(browser)}` : `${input.systemPrompt}\nComputer tools are disabled for this turn. Answer using the conversation only.`,
					messages: input.messages,
					tools: input.tools === "none" ? [] : toolSet.tools,
				},
				{
					model: input.model,
					reasoning: input.thinking,
					convertToLlm: (messages) => boundComputerScreenshots(messages.filter(isMessage)),
					toolExecution: "sequential",
					afterToolCall: async ({ result }) => {
						const details: unknown = result.details;
						return details && typeof details === "object" && "isError" in details && details.isError === true
							? { isError: true } : undefined;
					},
				},
				emit,
				input.signal,
				stream,
			);
			const failed = [...messages].reverse().find((message): message is AssistantMessage => isMessage(message) && message.role === "assistant");
			if (failed?.stopReason === "error") throw new Error(failed.errorMessage ?? "model stream failed");
			return { usage, aborted: failed?.stopReason === "aborted" || input.signal.aborted };
		} finally {
			try { await this.client?.turnEnded(); } catch {}
			this.activeTurnId = null;
		}
	}

	private activity(turnId: string, toolCallId: string, tool: ComputerToolName, phase: ComputerActivity["phase"], detail?: string): ComputerActivity {
		const labels: Record<ComputerToolName, string> = {
			stagehand_run: "Run browser actions",
			stagehand_snapshot: "Inspecting browser",
			stagehand_screenshot: "Capturing browser",
			ocu_list_apps: "Listing apps",
			ocu_get_app_state: "Inspecting app",
			ocu_click: "Click",
			ocu_drag: "Drag",
			ocu_press_key: "Press key",
			ocu_type_text: "Type text",
			ocu_scroll: "Scroll",
			ocu_set_value: "Set value",
			ocu_perform_secondary_action: "Perform action",
			ocu_run_actions: "Run actions",
			ocu_query_state: "Read control",
			ocu_list_workflows: "List workflows",
			ocu_save_workflow: "Save workflow",
			ocu_run_workflow: "Run workflow",
		};
		return { turnId, toolCallId, tool, phase, label: labels[tool], detail };
	}
}
