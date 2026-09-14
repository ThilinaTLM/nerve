import type { PolicySaveIntent } from "@nervekit/contracts/permissions";
import type { CanonicalCommand } from "./worker-protocol.js";

export class CanonicalPolicyStore {
  constructor(
    private readonly request: <T>(command: CanonicalCommand) => Promise<T>,
  ) {}

  readSaveIntent(saveIntentId: string) {
    return this.request<PolicySaveIntent | undefined>({
      kind: "read_timeline_policy_save_intent",
      saveIntentId,
    });
  }

  listPendingSaveIntents(limit = 128) {
    return this.request<PolicySaveIntent[]>({
      kind: "list_pending_timeline_policy_save_intents",
      limit,
    });
  }
}
