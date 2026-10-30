import assert from "node:assert/strict";
import {
  permissionRuleSetSchema,
  permissionOverlayDocumentSchema,
  permissionRuleSetIdSchema,
} from "@nervekit/contracts/permissions";
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
const toolName = (name: unknown) =>
  name === "plan_mode_present" ? "plan_present" : name;
function renameToolKeys(value: unknown): void {
  const object = record(value);
  if (object && Object.hasOwn(object, "plan_mode_present")) {
    assert(
      !Object.hasOwn(object, "plan_present") ||
        JSON.stringify(object.plan_present) ===
          JSON.stringify(object.plan_mode_present),
      "Conflicting plan tool settings",
    );
    object.plan_present = object.plan_mode_present;
    delete object.plan_mode_present;
  }
}

/** Named storage slots only: never rewrite instruction text or arbitrary arguments. */
export function convertDocument(
  value: unknown,
  kind: "harness" | "ui" | "capabilities" | "rule-set" | "permissions",
): unknown {
  const document = record(structuredClone(value));
  if (!document && (kind === "permissions" || kind === "rule-set"))
    return structuredClone(value);
  assert(document, "Expected a configuration object");
  if (kind === "harness" || kind === "ui") {
    for (const selection of [
      document,
      document.defaults,
      document.lastSelection,
      document.lastAgentSelection,
    ]) {
      const fields = record(selection);
      if (fields) delete fields.mode;
    }
  }
  if (kind === "harness") {
    const tools = record(document.tools);
    if (tools && Array.isArray(tools.disabled))
      // Older persisted arrays predate this configurable tool. Absence used to
      // mean the mode gate owned it, not an intentional global enablement.
      tools.disabled = [
        ...new Set([...tools.disabled.map(toolName), "plan_present"]),
      ];
  }
  if (kind === "rule-set" || kind === "permissions") {
    // Preserved policy domains may already contain newer documents. Never
    // downgrade/rewrite them; their owning loader reports scoped readiness.
    if (document.schemaVersion !== (kind === "rule-set" ? 1 : 2))
      return document;
    const policySchema =
      kind === "rule-set"
        ? permissionRuleSetSchema
        : permissionOverlayDocumentSchema;
    if (kind === "rule-set" && Object.hasOwn(document, "compatibleModes")) {
      const modes = document.compatibleModes;
      if (
        !Array.isArray(modes) ||
        modes.length > 64 ||
        modes.some((mode) => !permissionRuleSetIdSchema.safeParse(mode).success)
      )
        return structuredClone(value);
    }
    const baseline = structuredClone(document);
    if (kind === "rule-set") delete baseline.compatibleModes;
    // This converter is not a repair operation. Leave invalid policy bytes for
    // the owning health loader; selected/applicable policy remains fail-closed.
    if (!policySchema.safeParse(baseline).success)
      return structuredClone(value);
    const groups =
      kind === "rule-set"
        ? [document]
        : Array.isArray(document.overlays)
          ? document.overlays
          : [];
    let changed =
      kind === "rule-set" && Object.hasOwn(document, "compatibleModes");
    if (kind === "rule-set") delete document.compatibleModes;
    for (const group of groups) {
      const rules = record(group)?.rules;
      if (!Array.isArray(rules)) continue;
      for (const rule of rules) {
        const when = record(record(rule)?.when);
        if (
          when &&
          Array.isArray(when.toolNames) &&
          when.toolNames.includes("plan_mode_present")
        ) {
          when.toolNames = when.toolNames.map(toolName);
          changed = true;
        }
      }
    }
    if (changed) return policySchema.parse(document);
  }
  if (kind === "rule-set" || kind === "capabilities") {
    renameToolKeys(document.tools);
    renameToolKeys(document.toolSettings);
  }
  return document;
}
