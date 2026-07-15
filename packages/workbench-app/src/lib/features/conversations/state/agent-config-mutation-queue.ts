import type { AgentRecord, ModelSelection } from "$lib/api";

/**
 * Desired configuration fields for one agent. `undefined` means "no local
 * intent for this field"; `model: null` explicitly clears the model.
 */
export interface AgentConfigPatch {
  model?: ModelSelection | null;
  thinkingLevel?: AgentRecord["thinkingLevel"];
  mode?: AgentRecord["mode"];
  permissionLevel?: AgentRecord["permissionLevel"];
  approvalPolicy?: AgentRecord["approvalPolicy"];
}

export interface AgentConfigMutationQueueDeps {
  /** Performs one `agent.configure` request. */
  configure(agentId: string, patch: AgentConfigPatch): Promise<AgentRecord>;
  /** Reports the current outstanding desired state (undefined when clear). */
  onDesiredChanged?(
    agentId: string,
    desired: AgentConfigPatch | undefined,
  ): void;
  /** Installs every authoritative agent record returned by a request. */
  onAgentRecord?(agent: AgentRecord): void;
  /** Final success with no newer local intent: reconcile to clamped values. */
  onConfirmed?(agentId: string, agent: AgentRecord): void;
  /** A request failed; the failed desired fields were cleared. */
  onFailed?(agentId: string, error: unknown, failed: AgentConfigPatch): void;
}

interface AgentQueueEntry {
  desired: AgentConfigPatch;
  generation: number;
  pump?: Promise<void>;
}

const PATCH_FIELDS = [
  "model",
  "thinkingLevel",
  "mode",
  "permissionLevel",
  "approvalPolicy",
] as const;

/**
 * Per-agent serialized, coalescing configuration mutation queue.
 *
 * Local edits merge into one desired state that is published synchronously;
 * at most one `agent.configure` chain runs per agent. Mode-only and
 * runtime-config patches are sent as separate serialized requests so the
 * server's active-run update rules apply, and generation tags ensure a stale
 * response never clears a newer local intent.
 */
export class AgentConfigMutationQueue {
  private readonly entries = new Map<string, AgentQueueEntry>();

  constructor(private readonly deps: AgentConfigMutationQueueDeps) {}

  /** The outstanding local intent for the agent, if any. */
  desired(agentId: string): AgentConfigPatch | undefined {
    const entry = this.entries.get(agentId);
    return entry && hasFields(entry.desired) ? { ...entry.desired } : undefined;
  }

  /** Merges a local edit and starts (or extends) the request chain. */
  enqueue(agentId: string, patch: AgentConfigPatch): void {
    if (!hasFields(patch)) return;
    const entry = this.entries.get(agentId) ?? { desired: {}, generation: 0 };
    this.entries.set(agentId, entry);
    entry.desired = { ...entry.desired, ...definedFields(patch) };
    entry.generation += 1;
    this.publishDesired(agentId, entry);
    if (!entry.pump) {
      // Defer the first snapshot by one microtask so rapid successive edits
      // coalesce into a single request.
      entry.pump = Promise.resolve()
        .then(() => this.pump(agentId, entry))
        .finally(() => {
          entry.pump = undefined;
        });
    }
  }

  /** Resolves when no request chain remains for the agent. Never rejects. */
  async flush(agentId: string): Promise<void> {
    for (;;) {
      const pump = this.entries.get(agentId)?.pump;
      if (!pump) return;
      await pump;
    }
  }

  private async pump(agentId: string, entry: AgentQueueEntry): Promise<void> {
    while (hasFields(entry.desired)) {
      const snapshot = { ...entry.desired };
      const generation = entry.generation;
      try {
        let agent: AgentRecord | undefined;
        // Serialize the mode-only patch before the runtime-config patch so
        // the server accepts both while a run is active.
        const modePatch =
          snapshot.mode !== undefined ? { mode: snapshot.mode } : undefined;
        const runtimePatch = runtimeConfigFields(snapshot);
        if (modePatch) {
          agent = await this.deps.configure(agentId, modePatch);
          this.deps.onAgentRecord?.(agent);
        }
        if (runtimePatch) {
          agent = await this.deps.configure(agentId, runtimePatch);
          this.deps.onAgentRecord?.(agent);
        }
        if (entry.generation === generation) {
          entry.desired = {};
          this.publishDesired(agentId, entry);
          if (agent) this.deps.onConfirmed?.(agentId, agent);
        }
        // A newer desired state arrived in flight: loop and send it too. The
        // returned record already updated the authoritative cache, but the
        // newer local intent stays published until its own request settles.
      } catch (error) {
        entry.desired = withoutUnchangedFields(entry.desired, snapshot);
        this.publishDesired(agentId, entry);
        this.deps.onFailed?.(agentId, error, snapshot);
      }
    }
  }

  private publishDesired(agentId: string, entry: AgentQueueEntry): void {
    this.deps.onDesiredChanged?.(
      agentId,
      hasFields(entry.desired) ? { ...entry.desired } : undefined,
    );
  }
}

function hasFields(patch: AgentConfigPatch): boolean {
  return PATCH_FIELDS.some((field) => patch[field] !== undefined);
}

function definedFields(patch: AgentConfigPatch): AgentConfigPatch {
  const result: AgentConfigPatch = {};
  for (const field of PATCH_FIELDS) {
    if (patch[field] !== undefined) {
      (result as Record<string, unknown>)[field] = patch[field];
    }
  }
  return result;
}

function runtimeConfigFields(
  patch: AgentConfigPatch,
): AgentConfigPatch | undefined {
  const runtime: AgentConfigPatch = {};
  if (patch.model !== undefined) runtime.model = patch.model;
  if (patch.thinkingLevel !== undefined) {
    runtime.thinkingLevel = patch.thinkingLevel;
  }
  if (patch.permissionLevel !== undefined) {
    runtime.permissionLevel = patch.permissionLevel;
  }
  if (patch.approvalPolicy !== undefined) {
    runtime.approvalPolicy = patch.approvalPolicy;
  }
  return hasFields(runtime) ? runtime : undefined;
}

/** Drops fields whose desired value is exactly the failed snapshot value. */
function withoutUnchangedFields(
  desired: AgentConfigPatch,
  snapshot: AgentConfigPatch,
): AgentConfigPatch {
  const result: AgentConfigPatch = {};
  for (const field of PATCH_FIELDS) {
    const value = desired[field];
    if (value === undefined) continue;
    if (sameFieldValue(field, value, snapshot[field])) continue;
    (result as Record<string, unknown>)[field] = value;
  }
  return result;
}

function sameFieldValue(
  field: (typeof PATCH_FIELDS)[number],
  left: unknown,
  right: unknown,
): boolean {
  if (left === right) return true;
  if (field === "model") {
    const a = left as ModelSelection | null | undefined;
    const b = right as ModelSelection | null | undefined;
    return Boolean(
      a && b && a.provider === b.provider && a.modelId === b.modelId,
    );
  }
  if (field === "approvalPolicy") {
    const a = left as AgentRecord["approvalPolicy"] | undefined;
    const b = right as AgentRecord["approvalPolicy"] | undefined;
    return Boolean(a && b && a.autoApproveReadOnly === b.autoApproveReadOnly);
  }
  return false;
}
