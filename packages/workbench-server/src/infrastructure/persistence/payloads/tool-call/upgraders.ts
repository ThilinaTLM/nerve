import { toolCallRecordSchema } from "@nervekit/contracts/tools";
import {
  createJsonPayloadCodec,
  type PayloadCodec,
  type PayloadUpgraderChain,
} from "../codec.js";
import { isJsonObject, mergePreservingUnknown } from "../merge.js";

export const TOOL_CALL_PAYLOAD_VERSION = 2;

/**
 * v1 permission evidence predates the explicit winning/selected rule-set ids.
 * The final active rule set was the selected set under the old evaluator.
 */
export function upgradeToolCallV1ToV2(value: unknown): unknown {
  if (!isJsonObject(value)) return value;
  const evaluation = value.permissionEvaluation;
  if (!isJsonObject(evaluation)) return value;

  const activeRuleSetIds = evaluation.activeRuleSetIds;
  const selectedRuleSetId =
    Array.isArray(activeRuleSetIds) &&
    typeof activeRuleSetIds.at(-1) === "string"
      ? activeRuleSetIds.at(-1)
      : undefined;
  if (!selectedRuleSetId) return value;

  const patch: Record<string, unknown> = {};
  if (!("selectedRuleSetId" in evaluation)) {
    patch.selectedRuleSetId = selectedRuleSetId;
  }
  if (!("winningRuleSetId" in evaluation)) {
    patch.winningRuleSetId =
      evaluation.winningRuleOrigin === "baseline"
        ? "baseline"
        : selectedRuleSetId;
  }
  if (Object.keys(patch).length === 0) return value;

  return mergePreservingUnknown(value, {
    permissionEvaluation: patch,
  });
}

export const toolCallPayloadUpgraders = {
  1: upgradeToolCallV1ToV2,
} satisfies PayloadUpgraderChain;

export const toolCallPayloadCodec: PayloadCodec = createJsonPayloadCodec({
  currentVersion: TOOL_CALL_PAYLOAD_VERSION,
  upgraders: toolCallPayloadUpgraders,
  read: (value) => toolCallRecordSchema.parse(value),
});
