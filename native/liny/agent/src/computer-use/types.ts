import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "../config.ts";
import type { LinyRuntime } from "../agent-runtime.ts";
import type { Model, Api } from "@earendil-works/pi-ai";

export type ComputerToolName =
	| "stagehand_run"
	| "stagehand_snapshot"
	| "stagehand_screenshot"
	| "ocu_list_apps"
	| "ocu_get_app_state"
	| "ocu_click"
	| "ocu_drag"
	| "ocu_press_key"
	| "ocu_type_text"
	| "ocu_scroll"
	| "ocu_set_value"
	| "ocu_perform_secondary_action"
	| "ocu_run_actions"
	| "ocu_query_state"
	| "ocu_list_workflows"
	| "ocu_save_workflow"
	| "ocu_run_workflow";

export type ReadComputerToolName = "stagehand_snapshot" | "stagehand_screenshot" | "ocu_list_apps" | "ocu_get_app_state" | "ocu_query_state" | "ocu_list_workflows";
export type ActionComputerToolName = Exclude<ComputerToolName, ReadComputerToolName>;

export interface TurnOwner {
	readonly id: string;
	send(message: string): void;
}

export interface ComputerActivity {
	turnId: string;
	toolCallId: string;
	tool: ComputerToolName;
	label: string;
	phase: "inspecting" | "running" | "succeeded" | "failed";
	detail?: string;
}

export interface ComputerTurnInput {
	tools?: "computer" | "none";
	turnId: string;
	owner: TurnOwner;
	model: Model<Api>;
	thinking: ThinkingLevel;
	systemPrompt: string;
	messages: Message[];
	signal: AbortSignal;
}

export interface ComputerTurnSink {
	assistantDelta(text: string): void;
	appendMessage(message: Message): void;
	activity(activity: ComputerActivity): void;
}

export interface ComputerTurnOutcome {
	usage: { input: number; output: number; total: number };
	aborted: boolean;
}

export interface ComputerUseToolSet {
	tools: AgentTool[];
	isReadOnly(name: string): name is ReadComputerToolName;
	isKnown(name: string): name is ComputerToolName;
}

export interface ComputerTurnDependencies {
	models: LinyRuntime;
}
