import assert from "node:assert/strict";
import { convertEventPayload } from "./documents.js";
import { sha256 } from "./released-format.js";
import {
  objectValue,
  historicalReviewRequest,
  historicalReviewConfirmation,
  type HistoricalReviewRequest,
} from "./historical-plan-review.js";

export interface MetadataInput {
  events: readonly { id: string; payload: string }[];
  calls: readonly {
    id: string;
    toolName: string;
    interaction: string | null;
  }[];
}
export interface MetadataPatch {
  table: "conversation_event" | "tool_call";
  id: string;
  column: "payload" | "tool_name" | "interaction";
  beforeDigest: string;
  after: string;
  reasons?: string[];
}
export const eventConfirmationReason =
  "Reconstructed archival plan-review approval confirmation in conversation_event.payload";
export const callConfirmationReason =
  "Reconstructed archival plan-review approval confirmation in tool_call.interaction";
export const requestBindingReason =
  "Migrated historical plan-review request to a profile binding in tool_call.interaction";

/** Source-bound prepared DML. Stored prose and arbitrary tool arguments are not
 * renamed. These patches are planned now, applied only in the approved SQL phase. */
export function planMetadata(input: MetadataInput): MetadataPatch[] {
  const result: MetadataPatch[] = [];
  const requests = new Map<string, HistoricalReviewRequest>();
  const calls = input.calls.map((call) => {
    if (call.interaction === null) return { call, after: null, reasons: [] };
    const interaction = objectValue(JSON.parse(call.interaction));
    assert(interaction, "Invalid stored interaction");
    const reasons: string[] = [];
    if (interaction.kind === "plan_review") {
      const before = objectValue(interaction.request);
      assert(before, "Missing stored plan-review request");
      const request = historicalReviewRequest(before, call.id);
      requests.set(call.id, request);
      if (JSON.stringify(before) !== JSON.stringify(request))
        reasons.push(requestBindingReason);
      interaction.request = request;
      const resolution = objectValue(interaction.resolution);
      if (
        resolution &&
        historicalReviewConfirmation(resolution, request, call.id)
      )
        reasons.push(callConfirmationReason);
    }
    return { call, after: JSON.stringify(interaction), reasons };
  });
  for (const event of input.events) {
    const before = JSON.parse(event.payload);
    const after = convertEventPayload(before);
    const payload = objectValue(after)!;
    const reasons: string[] = [];
    if (JSON.stringify(before) !== JSON.stringify(after))
      reasons.push(
        "Renamed historical planning tool metadata in conversation_event.payload",
      );
    const resolution = objectValue(payload.interactionResolution);
    if (
      resolution?.kind === "plan_review" &&
      resolution.decision === "approve" &&
      !Object.hasOwn(resolution, "confirmation")
    ) {
      assert(
        typeof payload.toolCallId === "string",
        "Missing historical plan-review tool call ID",
      );
      const id = payload.toolCallId;
      const request =
        requests.get(id) ??
        historicalReviewRequest(
          { approvalProfile: objectValue(payload.arguments)?.approvalProfile },
          id,
        );
      if (historicalReviewConfirmation(resolution, request, id))
        reasons.push(eventConfirmationReason);
    }
    if (JSON.stringify(before) !== JSON.stringify(after))
      result.push({
        table: "conversation_event",
        id: event.id,
        column: "payload",
        beforeDigest: sha256(event.payload),
        after: JSON.stringify(after),
        reasons,
      });
  }
  for (const { call, after, reasons } of calls) {
    if (call.toolName === "plan_mode_present")
      result.push({
        table: "tool_call",
        id: call.id,
        column: "tool_name",
        beforeDigest: sha256(call.toolName),
        after: "plan_present",
        reasons: [
          "Renamed historical planning tool metadata in tool_call.tool_name",
        ],
      });
    if (
      after !== null &&
      JSON.stringify(JSON.parse(call.interaction!)) !== after
    )
      result.push({
        table: "tool_call",
        id: call.id,
        column: "interaction",
        beforeDigest: sha256(call.interaction!),
        after,
        reasons,
      });
  }
  return result;
}
