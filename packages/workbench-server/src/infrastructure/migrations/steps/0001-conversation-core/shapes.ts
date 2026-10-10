import assert from "node:assert/strict";
import type { Legacy } from "./legacy.reader.js";

export type Asset = Legacy;
export type ConversationEvent = Legacy;
function object(value: unknown): asserts value is Legacy {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected an object",
  );
}
const shape = (validate: (value: Legacy) => void) => ({
  parse(value: Legacy): Legacy {
    object(value);
    validate(value);
    return value;
  },
});
const row = shape((value) => {
  assert(typeof value.id === "string" && value.id.length > 0, "Missing row ID");
});
export const projectSchema = row;
export const conversationSchema = row;
export const scratchNoteSchema = row;
export const trustedResourceSchema = row;
export const assetSchema = row;
export const conversationConfigSchema = shape((value) => {
  object(value.model);
  assert(
    typeof value.model.provider === "string" &&
      typeof value.model.modelId === "string",
    "Missing model selection",
  );
});
export const commandPreparationSchema = shape((value) => {
  assert(Array.isArray(value.blocks));
});
export const conversationEventSchema = shape((value) => {
  assert(
    typeof value.id === "string" && typeof value.conversationId === "string",
  );
  assert(Number.isSafeInteger(value.sequence) && value.sequence > 0);
  object(value.payload);
  const payload = value.payload;
  if (value.type === "user_message")
    assert(
      typeof payload.text === "string" &&
        typeof payload.originalText === "string",
    );
  else if (value.type === "assistant_message") {
    assert(Array.isArray(payload.content));
    object(payload.usage);
    for (const block of payload.content) {
      assert(["text", "thinking", "toolCall"].includes(block.type));
      if (block.type === "toolCall") {
        assert(typeof block.id === "string" && typeof block.name === "string");
        object(block.arguments);
      }
    }
  } else if (value.type === "tool_call_response") {
    assert(Array.isArray(payload.agentProjection));
    object(payload.userProjection);
    assert(!("result" in payload) && !("modelContent" in payload));
    assert(
      ["completed", "failed", "denied", "cancelled", "indeterminate"].includes(
        payload.outcome,
      ),
    );
    if (payload.origin === "model")
      assert(
        typeof payload.providerCallId === "string" &&
          typeof payload.assistantEventId === "string",
      );
  } else if (value.type === "compaction")
    assert(typeof payload.summary === "string");
  else
    assert(
      value.type === "system_event" &&
        ["notification", "execution_state"].includes(payload.subtype),
    );
});
export const supervisionSchema = {
  safeParse(value: Legacy) {
    return value && ["allow", "deny", "approval"].includes(value.decision)
      ? { success: true, data: value }
      : { success: false, data: null };
  },
};
export const interactionResolutionSchema = {
  safeParse(value: Legacy) {
    const valid =
      value &&
      (value.kind === "approval" || value.kind === "plan_review"
        ? ["approve", "deny", "reject"].includes(value.decision)
        : value.kind === "user_input" &&
          value.answers &&
          typeof value.answers === "object");
    return valid
      ? { success: true, data: value }
      : { success: false, data: null };
  },
};
export const permissionOverlayDocumentForOriginSchema = (
  origin: "conversation",
) =>
  shape((value) => {
    assert.equal(origin, "conversation");
    assert(
      value.schemaVersion === 2 &&
        Array.isArray(value.overlays) &&
        value.overlays.length <= 256,
      "Invalid permission overlay document",
    );
    const ids = new Set<string>();
    let count = 0;
    for (const overlay of value.overlays) {
      assert(
        typeof overlay.ruleSetId === "string" &&
          overlay.ruleSetId.length &&
          !ids.has(overlay.ruleSetId),
      );
      ids.add(overlay.ruleSetId);
      assert(Array.isArray(overlay.rules));
      const rules = new Set<string>(),
        priorities = new Set<number>();
      for (const rule of overlay.rules) {
        assert(typeof rule.id === "string" && !rules.has(rule.id));
        rules.add(rule.id);
        assert(
          Number.isInteger(rule.priority) &&
            Math.abs(rule.priority) <= 1000 &&
            !priorities.has(rule.priority),
        );
        priorities.add(rule.priority);
        assert(
          rule.enforcement === "overridable" &&
            typeof rule.enabled === "boolean" &&
            ["allow", "prompt", "deny"].includes(rule.decision),
        );
        object(rule.when);
        count++;
      }
    }
    assert(count <= 256);
  });
