import type { SandboxConfigV1 } from "@nervekit/shared";
import { Redactor } from "../security/redaction.js";
export function buildSandboxSnapshot(input: {
  config?: SandboxConfigV1;
  configDigest?: string;
  sandboxId?: string;
  instanceId: string;
  status: string;
  connected?: boolean;
  stale?: boolean;
  updatedAt?: string;
  lastEventSeq?: number;
  lastEventAt?: string;
  connectivity?: unknown;
  conversations?: unknown[];
  agents?: unknown[];
  runs?: unknown[];
  replayCursors?: unknown[];
  toolGroups?: unknown[];
  setup?: unknown;
  setupTimeline?: unknown[];
  models?: unknown[];
  secretStores?: unknown[];
  credentials?: unknown[];
  network?: unknown;
  limitations?: string[];
}): Record<string, unknown> {
  const redactor = new Redactor();
  return redactor.redact({
    ...input,
    config: input.config
      ? {
          version: input.config.version,
          agent: input.config.agent,
        }
      : undefined,
  });
}
