import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

export const appSchema = Type.String({ minLength: 1, maxLength: 300, description: "App name or bundle identifier." });
export const selectorSchema = Type.Object({
	identifier: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
	role: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
}, { additionalProperties: false, minProperties: 1, description: "Exact accessibility identity. Must match one control. Prefer identifier; add role/title to disambiguate." });

const indexed = Type.Object({ element_index: Type.String({ pattern: "^[0-9]+$", maxLength: 20 }) }, { additionalProperties: false });
const semantic = Type.Object({ target: selectorSchema }, { additionalProperties: false });
const coordinates = Type.Object({ x: Type.Number({ minimum: 0, maximum: 100_000 }), y: Type.Number({ minimum: 0, maximum: 100_000 }) }, { additionalProperties: false });
const clickOptions = {
	mouse_button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")])),
	click_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
};

export const actionSchema = Type.Union([
	Type.Object({ tool: Type.Literal("click"), app: appSchema, ...semantic.properties, ...clickOptions }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("click"), app: appSchema, ...indexed.properties, ...clickOptions }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("click"), app: appSchema, ...coordinates.properties, ...clickOptions }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("press_key"), app: appSchema, key: Type.String({ minLength: 1, maxLength: 100 }) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("type_text"), app: appSchema, text: Type.String({ minLength: 1, maxLength: 20_000 }) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("drag"), app: appSchema, from_x: Type.Number({ minimum: 0, maximum: 100_000 }), from_y: Type.Number({ minimum: 0, maximum: 100_000 }), to_x: Type.Number({ minimum: 0, maximum: 100_000 }), to_y: Type.Number({ minimum: 0, maximum: 100_000 }) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("set_value"), app: appSchema, ...semantic.properties, value: Type.String({ maxLength: 20_000 }) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("scroll"), app: appSchema, ...semantic.properties, direction: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]), pages: Type.Optional(Type.Number({ minimum: 0.1, maximum: 20 })) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("perform_secondary_action"), app: appSchema, ...semantic.properties, action: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("set_value"), app: appSchema, ...indexed.properties, value: Type.String({ maxLength: 20_000 }) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("scroll"), app: appSchema, ...indexed.properties, direction: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]), pages: Type.Optional(Type.Number({ minimum: 0.1, maximum: 20 })) }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("perform_secondary_action"), app: appSchema, ...indexed.properties, action: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }),
]);

export const conditionSchema = Type.Union([
	Type.Object({ kind: Type.Literal("exists"), app: appSchema, target: selectorSchema }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("focused"), app: appSchema, target: selectorSchema }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("value"), app: appSchema, target: selectorSchema, equals: Type.String({ maxLength: 20_000 }) }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("enabled"), app: appSchema, target: selectorSchema, equals: Type.Boolean() }, { additionalProperties: false }),
	Type.Object({ kind: Type.Literal("window_title"), app: appSchema, equals: Type.String({ maxLength: 2_000 }) }, { additionalProperties: false }),
]);

const checkpoint = Type.Union([
	Type.Object({ tool: Type.Literal("assert"), condition: conditionSchema }, { additionalProperties: false }),
	Type.Object({ tool: Type.Literal("wait_for"), condition: conditionSchema, timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 15_000 })) }, { additionalProperties: false }),
]);
const basicStep = Type.Union([actionSchema, checkpoint]);
const branch = Type.Object({
	tool: Type.Literal("when"), condition: conditionSchema,
	then: Type.Array(basicStep, { minItems: 1, maxItems: 30 }),
	otherwise: Type.Optional(Type.Array(basicStep, { minItems: 1, maxItems: 30 })),
}, { additionalProperties: false });
export const planSchema = Type.Object({
	actions: Type.Array(Type.Union([basicStep, branch]), { minItems: 1, maxItems: 30 }),
	observation: Type.Optional(Type.Union([Type.Literal("full"), Type.Literal("text")])),
}, { additionalProperties: false });
export type ComputerPlan = Static<typeof planSchema>;

export function parsePlan(value: unknown): ComputerPlan {
	if (!Check(planSchema, value)) throw new Error("Invalid computer-use plan. Check targets, conditions, and action arguments.");
	const total = value.actions.reduce((count, step) => count + 1 + (step.tool === "when" ? step.then.length + (step.otherwise?.length ?? 0) : 0), 0);
	if (total > 30) throw new Error("Computer-use plans accept at most 30 total steps, including branches.");
	return value;
}

export function planApps(plan: ComputerPlan): string[] {
	const apps = new Set<string>();
	for (const step of plan.actions) {
		if ("condition" in step) apps.add(step.condition.app);
		else apps.add(step.app);
		if (step.tool === "when") for (const nested of [...step.then, ...(step.otherwise ?? [])]) {
			apps.add("condition" in nested ? nested.condition.app : nested.app);
		}
	}
	return [...apps];
}
