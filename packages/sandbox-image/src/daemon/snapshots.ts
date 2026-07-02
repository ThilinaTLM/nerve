import type { SandboxConfigV1 } from "@nervekit/shared";
import { Redactor } from "../security/redaction.js";
export function buildSandboxSnapshot(input: {
  config?: SandboxConfigV1;
  configDigest?: string;
  status: string;
  connectivity?: unknown;
  conversations?: unknown[];
  runs?: unknown[];
  cursors?: unknown;
}): Record<string, unknown> {
  const redactor = new Redactor();
  return redactor.redact({
    ...input,
    config: input.config
      ? {
          version: input.config.version,
          identity: input.config.identity,
          agent: input.config.agent,
        }
      : undefined,
  });
}
