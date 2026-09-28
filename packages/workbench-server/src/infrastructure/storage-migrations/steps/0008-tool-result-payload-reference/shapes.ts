import {
  looseObjectV1,
  nonnegativeIntegerV1,
  stringV1,
} from "../../kit/shapes/v1.js";

export interface LegacyToolResultPayloadReferenceV1 {
  version: 1;
  kind: "tool_result";
  conversationId: string;
  toolCallId: string;
  logicalPath: string;
  digest: string;
  byteLength: number;
  mediaType: "application/json";
  encoding: "utf-8";
  completeness: "complete" | "legacy_bounded";
}

/** Frozen, minimal v1 shape. Unknown enclosing tool-call fields are preserved. */
export function legacyToolResultPayloadReferenceV1(
  value: unknown,
): LegacyToolResultPayloadReferenceV1 {
  const object = looseObjectV1(value, "legacy tool-result payload reference");
  const conversationId = stringV1(object.conversationId, "conversationId");
  const toolCallId = stringV1(object.toolCallId, "toolCallId");
  const logicalPath = stringV1(object.logicalPath, "logicalPath");
  const digest = stringV1(object.digest, "digest");
  const completeness = stringV1(object.completeness, "completeness");
  if (object.version !== 1 || object.kind !== "tool_result")
    throw new Error("Not a v1 tool-result payload reference.");
  if (!conversationId.startsWith("conv_") || !toolCallId.startsWith("tool_"))
    throw new Error("Legacy tool-result owners are invalid.");
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new Error("Legacy tool-result digest is invalid.");
  if (object.mediaType !== "application/json" || object.encoding !== "utf-8")
    throw new Error("Legacy tool-result encoding is invalid.");
  if (completeness !== "complete" && completeness !== "legacy_bounded")
    throw new Error("Legacy tool-result completeness is invalid.");
  return {
    version: 1,
    kind: "tool_result",
    conversationId,
    toolCallId,
    logicalPath,
    digest,
    byteLength: nonnegativeIntegerV1(object.byteLength, "byteLength"),
    mediaType: "application/json",
    encoding: "utf-8",
    completeness,
  };
}
