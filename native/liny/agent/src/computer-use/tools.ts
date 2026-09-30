import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { planSchema, parsePlan, planApps, selectorSchema } from "./plan.ts";
import { ComputerWorkflows, saveWorkflowSchema, runWorkflowSchema } from "./workflows.ts";
import type { OcuMcpClient } from "./mcp-client.ts";
import type {
	ComputerToolName,
	ComputerUseToolSet,
	ReadComputerToolName,
} from "./types.ts";

const app = Type.String({ description: "App name or bundle identifier, for example TextEdit or com.apple.TextEdit." });
const elementIndex = Type.String({ description: "Element index from the latest get_app_state result." });

const definitions = [
	{
		name: "ocu_list_apps",
		label: "List apps",
		description: "List apps currently running or recently used on this Mac.",
		parameters: Type.Object({}),
	},
	{
		name: "ocu_get_app_state",
		label: "Inspect app",
		description: "Inspect an app. Set screenshot=false for text-only state. Set retain_for_comparison=true to retain this screenshot alongside the latest one during this turn.",
		parameters: Type.Object({
			app,
			screenshot: Type.Optional(Type.Boolean()),
			retain_for_comparison: Type.Optional(Type.Boolean()),
			text_limit: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Literal("max")])),
			max_tree_nodes: Type.Optional(Type.Integer({ minimum: 1 })),
			max_tree_depth: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
	},
	{
		name: "ocu_click",
		label: "Click",
		description: "Click an app element by index or screenshot coordinates.",
		parameters: Type.Object({
			app,
			element_index: Type.Optional(elementIndex),
			x: Type.Optional(Type.Number()),
			y: Type.Optional(Type.Number()),
			mouse_button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")])),
			click_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
		}),
	},
	{
		name: "ocu_drag",
		label: "Drag",
		description: "Drag between two screenshot coordinates in an app.",
		parameters: Type.Object({ app, from_x: Type.Number(), from_y: Type.Number(), to_x: Type.Number(), to_y: Type.Number() }),
	},
	{
		name: "ocu_press_key",
		label: "Press key",
		description: "Press a key or key combination in an app.",
		parameters: Type.Object({ app, key: Type.String({ maxLength: 100 }) }),
	},
	{
		name: "ocu_type_text",
		label: "Type text",
		description: "Enter literal text in the focused element. Editable accessibility fields append to their current value; this does not replace selected text. For a requested replacement, use ocu_set_value or a native set_value step and verify the resulting value.",
		parameters: Type.Object({ app, text: Type.String({ maxLength: 20_000 }) }),
	},
	{
		name: "ocu_scroll",
		label: "Scroll",
		description: "Scroll an app element in a direction.",
		parameters: Type.Object({
			app,
			element_index: elementIndex,
			direction: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]),
			pages: Type.Optional(Type.Number({ minimum: 0.1, maximum: 20 })),
		}),
	},
	{
		name: "ocu_set_value",
		label: "Set value",
		description: "Replace the complete value of an editable accessibility element. Prefer this for replacing field contents instead of select-all followed by type_text.",
		parameters: Type.Object({ app, element_index: elementIndex, value: Type.String({ maxLength: 20_000 }) }),
	},
	{
		name: "ocu_perform_secondary_action",
		label: "Perform action",
		description: "Invoke an accessibility action explicitly exposed by an app element.",
		parameters: Type.Object({ app, element_index: elementIndex, action: Type.String({ maxLength: 200 }) }),
	},
	{
		name: "ocu_run_actions",
		label: "Run actions",
		description: "Execute up to 30 steps natively. Use semantic targets, assert, wait_for, and when for local conditions. Stop on failure and return final state. Use observation=text when screenshots are unnecessary. Coordinates/indices cannot follow an earlier mutation of the same app.",
		parameters: planSchema,
	},
	{ name: "ocu_query_state", label: "Read control", description: "Read one uniquely identified control without a screenshot or serialized accessibility tree. Use its semantic target for subsequent actions.", parameters: Type.Object({ app, target: selectorSchema }, { additionalProperties: false }) },
	{ name: "ocu_list_workflows", label: "List workflows", description: "List this account's saved verified workflows and their required parameters.", parameters: Type.Object({}, { additionalProperties: false }) },
	{ name: "ocu_save_workflow", label: "Save workflow", description: "Save the last successful native plan with initial/final checks. Parameterize every entered text/value. Do not save credentials. Requires semantic targets and an executed sequence without branches.", parameters: saveWorkflowSchema },
	{ name: "ocu_run_workflow", label: "Run workflow", description: "Run a saved workflow with new parameter values. Recheck preconditions and final state; stop if the UI differs.", parameters: runWorkflowSchema },
] as const satisfies readonly { name: ComputerToolName; label: string; description: string; parameters: TSchema }[];

const readOnly = new Set<ComputerToolName>(["ocu_list_apps", "ocu_get_app_state", "ocu_query_state", "ocu_list_workflows"]);
const names = new Set<ComputerToolName>(definitions.map((definition) => definition.name));

function toAgentContent(content: Awaited<ReturnType<OcuMcpClient["callTool"]>>["content"]): ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] {
	const converted: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
	for (const block of content) {
		if (block.type === "text") {
			converted.push({ type: "text", text: typeof block.text === "string" ? block.text : JSON.stringify(block.text) });
			continue;
		}
		if (block.type === "image" && block.data) {
			converted.push({ type: "image", data: block.data, mimeType: block.mimeType ?? "image/png" });
			continue;
		}
		converted.push({ type: "text", text: JSON.stringify(block) });
	}
	return converted;
}

export function createComputerUseTools(client: Pick<OcuMcpClient, "callTool">, workflows = new ComputerWorkflows()): ComputerUseToolSet {
	const tools: AgentTool[] = definitions.map((definition): AgentTool<TSchema> => ({
		name: definition.name,
		label: definition.label,
		description: definition.description + (definition.name === "ocu_run_workflow" ? workflows.catalog() : ""),
		parameters: definition.parameters,
		executionMode: "sequential",
		async execute(_toolCallId, params: unknown, signal) {
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
			if (!Check(definition.parameters, params)) throw new Error(`Invalid ${definition.name} arguments`);
			if (definition.name === "ocu_list_workflows") return textResult(definition.name, JSON.stringify(workflows.list()));
			if (definition.name === "ocu_save_workflow") {
				workflows.save(params);
				return textResult(definition.name, "Saved verified workflow for this account.");
			}
			if (definition.name === "ocu_run_actions" || definition.name === "ocu_run_workflow") {
				const plan = definition.name === "ocu_run_actions" ? parsePlan(params) : workflows.expand(params);
				workflows.beginExecution();
				const result = await client.callTool("run_actions", plan, signal);
				if (!result.isError) workflows.completed(plan, result.structuredContent);
				return agentResult(definition.name, result, planApps(plan), false);
			}
			if (!readOnly.has(definition.name)) workflows.beginExecution();
			const comparison = "retain_for_comparison" in params && params.retain_for_comparison === true;
			const args = Object.fromEntries(Object.entries(params).filter(([key]) => key !== "retain_for_comparison"));
			const result = await client.callTool(definition.name.replace(/^ocu_/, ""), args, signal);
			return agentResult(definition.name, result, "app" in params && typeof params.app === "string" ? [params.app] : [], comparison);
		},
	}));

	return {
		tools,
		isReadOnly(name): name is ReadComputerToolName { return [...readOnly].some((entry) => entry === name); },
		isKnown(name): name is ComputerToolName { return [...names].some((entry) => entry === name); },
	};
}

function textResult(tool: ComputerToolName, text: string) {
	return { content: [{ type: "text" as const, text }], details: { tool, isError: false, imageApps: [], comparison: false } };
}

export function agentResult(tool: ComputerToolName, result: Awaited<ReturnType<OcuMcpClient["callTool"]>>, apps: string[], comparison: boolean) {
	let imageApps = apps.map((app) => app.toLowerCase());
	const native = result.structuredContent;
	if (native && typeof native === "object" && "observations" in native && Array.isArray(native.observations)) {
		imageApps = native.observations.flatMap((entry: unknown) => {
			if (!entry || typeof entry !== "object" || !("hasImage" in entry) || entry.hasImage !== true) return [];
			const app = "bundleIdentifier" in entry ? entry.bundleIdentifier : "app" in entry ? entry.app : undefined;
			return typeof app === "string" ? [app.toLowerCase()] : [];
		});
	} else {
		const canonical = result.content.find((block) => block.type === "text")?.text?.match(/^App=(\S+)/m)?.[1];
		if (canonical) imageApps = [canonical.toLowerCase()];
	}
	return { content: toAgentContent(result.content), details: { tool, isError: result.isError, imageApps, comparison, native } };
}
