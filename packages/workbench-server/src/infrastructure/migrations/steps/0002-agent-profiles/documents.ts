import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StepContext } from "../../framework/step.js";
import { json, safePath, writeJson } from "./files.js";

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
  kind: "harness" | "ui" | "capabilities" | "rule-set",
): unknown {
  const document = record(structuredClone(value));
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
  if (kind === "rule-set") delete document.compatibleModes;
  if (kind === "rule-set" || kind === "capabilities") {
    renameToolKeys(document.tools);
    renameToolKeys(document.toolSettings);
  }
  return document;
}

export type DocumentFile = {
  path: string;
  kind: "harness" | "ui" | "capabilities" | "rule-set";
  root: string;
};
export function documentFiles(
  home: string,
  projects: readonly string[],
  conversations: readonly string[],
): DocumentFile[] {
  const result: DocumentFile[] = [];
  for (const root of [home, ...projects]) {
    for (const kind of ["harness", "ui", "capabilities"] as const)
      result.push({ path: join(root, "config", `${kind}.json`), kind, root });
    const rules = join(root, "config", "rule-sets");
    safePath(rules);
    if (existsSync(rules))
      for (const file of readdirSync(rules).sort())
        if (file.endsWith(".json"))
          result.push({ path: join(rules, file), kind: "rule-set", root });
  }
  for (const conversation of conversations)
    result.push({
      path: join(
        home,
        "data",
        "conversations",
        conversation,
        "config",
        "capabilities.json",
      ),
      kind: "capabilities",
      root: home,
    });
  return result;
}
export function convertFile(ctx: StepContext, file: DocumentFile): void {
  safePath(file.path);
  if (!existsSync(file.path)) return;
  const before = json(file.path);
  const after = convertDocument(before, file.kind);
  if (JSON.stringify(before) !== JSON.stringify(after))
    writeJson(ctx, file.path, after);
}

/** Historical transcript/projection metadata, not agent-visible prose. */
export function convertEventPayload(value: unknown): unknown {
  const payload = record(structuredClone(value));
  assert(payload, "Expected event payload");
  if (Array.isArray(payload.content))
    for (const block of payload.content) {
      const entry = record(block);
      if (entry?.type === "toolCall") entry.name = toolName(entry.name);
    }
  if (Object.hasOwn(payload, "toolName"))
    payload.toolName = toolName(payload.toolName);
  const projection = record(payload.userProjection);
  if (projection && Object.hasOwn(projection, "toolName"))
    projection.toolName = toolName(projection.toolName);
  return payload;
}
