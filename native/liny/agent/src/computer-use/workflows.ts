import { readFileSync } from "node:fs";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { writePrivateFile } from "../private-files.ts";
import { parsePlan, planSchema, type ComputerPlan } from "./plan.ts";

const nameSchema = Type.String({ pattern: "^[a-z][a-z0-9_]{0,47}$" });
const parameterSchema = Type.Array(Type.Object({ name: nameSchema, value: Type.String({ minLength: 1, maxLength: 20_000 }) }, { additionalProperties: false }), { maxItems: 20 });
export const saveWorkflowSchema = Type.Object({
	name: nameSchema,
	description: Type.String({ minLength: 1, maxLength: 500 }),
	parameters: parameterSchema,
}, { additionalProperties: false });
export const runWorkflowSchema = Type.Object({
	name: nameSchema,
	parameters: Type.Record(nameSchema, Type.String({ maxLength: 20_000 })),
	observation: Type.Optional(Type.Union([Type.Literal("full"), Type.Literal("text")])),
}, { additionalProperties: false });

const storedSchema = Type.Object({
	version: Type.Literal(1),
	workflows: Type.Array(Type.Object({
		name: nameSchema, description: Type.String({ minLength: 1, maxLength: 500 }),
		parameters: Type.Array(nameSchema, { maxItems: 20, uniqueItems: true }),
		plan: planSchema, verifiedAt: Type.Number({ minimum: 0 }),
	}, { additionalProperties: false }), { maxItems: 32 }),
}, { additionalProperties: false });
type Workflow = Static<typeof storedSchema>["workflows"][number];
type Parameters = Static<typeof parameterSchema>;

function transformPayloads(value: unknown, replace: (value: string) => string): unknown {
	if (Array.isArray(value)) return value.map((item) => transformPayloads(item, replace));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
		const payload = key === "text" || key === "value" || (key === "equals" && "kind" in value && value.kind === "value");
		return [key, payload && typeof entry === "string" ? replace(entry) : transformPayloads(entry, replace)];
	}));
}

function ensureReusable(plan: ComputerPlan): void {
	const first = plan.actions[0];
	const last = plan.actions.at(-1);
	if (!first || !last || !["assert", "wait_for"].includes(first.tool) || !["assert", "wait_for"].includes(last.tool)) {
		throw new Error("A reusable workflow needs an initial state check and a final outcome check.");
	}
	for (const step of plan.actions) {
		if (step.tool === "when") throw new Error("Save an executed branch as its own workflow; unexecuted branches are not verified.");
		if ("element_index" in step || "x" in step || step.tool === "drag") {
			throw new Error("Reusable workflows require semantic targets instead of indices or coordinates.");
		}
	}
}

export class ComputerWorkflows {
	private verified: ComputerPlan | null = null;
	private volatile: Workflow[] = [];

	constructor(private readonly path?: string) {}

	beginExecution(): void { this.verified = null; }

	completed(plan: ComputerPlan, nativeDetails: unknown): void {
		if (nativeDetails && typeof nativeDetails === "object" && "nativeVersion" in nativeDetails && nativeDetails.nativeVersion === 1
			&& "verified" in nativeDetails && nativeDetails.verified === true) this.verified = structuredClone(plan);
	}

	list(): Pick<Workflow, "name" | "description" | "parameters">[] {
		return this.read().map(({ name, description, parameters }) => ({ name, description, parameters }));
	}

	catalog(): string {
		try {
			const workflows = this.list();
			return workflows.length ? ` Available workflows: ${workflows.map(({ name, description, parameters }) => `${name}(${parameters.join(",")}): ${description.slice(0, 120)}`).join("; ")}` : " No workflows are saved yet.";
		} catch { return " The saved library could not be read. Use ocu_list_workflows to inspect the error."; }
	}

	save(input: unknown): void {
		if (!Check(saveWorkflowSchema, input)) throw new Error("Invalid workflow name, description, or parameters.");
		if (!this.verified) throw new Error("Run a plan with passing final conditions before saving it.");
		ensureReusable(this.verified);
		const parameters: Parameters = input.parameters;
		if (new Set(parameters.map(({ name }) => name)).size !== parameters.length || new Set(parameters.map(({ value }) => value)).size !== parameters.length) {
			throw new Error("Workflow parameter names and example values must be unique.");
		}
		const replacements = new Map(parameters.map(({ name, value }) => [value, `{{${name}}}`]));
		const used = new Set<string>();
		const template = parsePlan(transformPayloads(this.verified, (value) => {
			const replacement = replacements.get(value);
			if (!replacement) throw new Error("Parameterize every entered text/value and value checkpoint before saving a workflow.");
			used.add(value);
			return replacement;
		}));
		if (used.size !== parameters.length) throw new Error("A workflow parameter does not match a text/value field in the successful plan.");
		const workflows = this.read().filter(({ name }) => name !== input.name);
		if (workflows.length >= 32) throw new Error("The workflow library is full. Replace an existing named workflow.");
		workflows.push({ name: input.name, description: input.description, parameters: parameters.map(({ name }) => name), plan: template, verifiedAt: Date.now() });
		if (this.path) writePrivateFile(this.path, `${JSON.stringify({ version: 1, workflows })}\n`);
		else this.volatile = workflows;
	}

	expand(input: unknown): ComputerPlan {
		if (!Check(runWorkflowSchema, input)) throw new Error("Invalid workflow invocation.");
		const workflow = this.read().find(({ name }) => name === input.name);
		if (!workflow) throw new Error(`Unknown workflow: ${input.name}`);
		ensureReusable(workflow.plan);
		const names = Object.keys(input.parameters);
		if (names.length !== workflow.parameters.length || names.some((name) => !workflow.parameters.includes(name))) {
			throw new Error(`Provide exactly these workflow parameters: ${workflow.parameters.join(", ")}`);
		}
		const plan = parsePlan(transformPayloads(workflow.plan, (value) => {
			const name = value.match(/^\{\{([a-z][a-z0-9_]{0,47})\}\}$/)?.[1];
			const replacement = name === undefined ? undefined : input.parameters[name];
			if (replacement === undefined) throw new Error("Workflow contains an invalid parameter reference.");
			return replacement;
		}));
		return { ...plan, observation: input.observation ?? plan.observation };
	}

	private read(): Workflow[] {
		if (!this.path) return this.volatile;
		let raw: string;
		try { raw = readFileSync(this.path, "utf8"); }
		catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
			throw error;
		}
		if (raw.length > 1_000_000) throw new Error("Workflow library exceeds its size limit.");
		const parsed: unknown = JSON.parse(raw);
		if (!Check(storedSchema, parsed)) throw new Error("Workflow library is invalid or uses an unsupported version.");
		return parsed.workflows;
	}
}
