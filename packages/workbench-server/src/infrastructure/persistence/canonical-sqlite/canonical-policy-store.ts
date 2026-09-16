import type {
  PolicyDiagnostic,
  PolicyFallbackDecision,
  PolicySaveIntent,
} from "@nervekit/contracts/permissions";
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

  readDiagnostic(diagnosticId: string) {
    return this.request<PolicyDiagnostic | undefined>({
      kind: "read_timeline_policy_diagnostic",
      diagnosticId,
    });
  }

  readActiveFallbacks(requestedRuleSetId: string) {
    return this.request<
      Array<{ decision: PolicyFallbackDecision; diagnostic: PolicyDiagnostic }>
    >({
      kind: "read_timeline_active_policy_fallback",
      requestedRuleSetId,
    });
  }

  listPendingSaveIntents(limit = 128) {
    return this.request<PolicySaveIntent[]>({
      kind: "list_pending_timeline_policy_save_intents",
      limit,
    });
  }
}
