import assert from "node:assert/strict";
import { convertEventPayload } from "./documents.js";
import { sha256 } from "./released-format.js";

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
}
/** Source-bound prepared DML. Stored prose and arbitrary tool arguments are not
 * renamed. These patches are planned now, applied only in the approved SQL phase. */
export function planMetadata(input: MetadataInput): MetadataPatch[] {
  const result: MetadataPatch[] = [];
  for (const event of input.events) {
    const after = JSON.stringify(
      convertEventPayload(JSON.parse(event.payload)),
    );
    if (JSON.stringify(JSON.parse(event.payload)) !== after)
      result.push({
        table: "conversation_event",
        id: event.id,
        column: "payload",
        beforeDigest: sha256(event.payload),
        after,
      });
  }
  for (const call of input.calls) {
    if (call.toolName === "plan_mode_present")
      result.push({
        table: "tool_call",
        id: call.id,
        column: "tool_name",
        beforeDigest: sha256(call.toolName),
        after: "plan_present",
      });
    if (call.interaction === null) continue;
    const raw: unknown = JSON.parse(call.interaction);
    assert(
      raw && typeof raw === "object" && !Array.isArray(raw),
      "Invalid stored interaction",
    );
    const interaction = raw as {
      kind?: string;
      request?: { approvalProfile?: string };
    };
    if (
      interaction.kind === "plan_review" &&
      interaction.request &&
      !Object.hasOwn(interaction.request, "approvalProfile")
    ) {
      interaction.request.approvalProfile = "coding";
      result.push({
        table: "tool_call",
        id: call.id,
        column: "interaction",
        beforeDigest: sha256(call.interaction),
        after: JSON.stringify(interaction),
      });
    }
  }
  return result;
}
