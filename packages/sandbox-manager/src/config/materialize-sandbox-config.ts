import {
  type SandboxConfigV1,
  sandboxConfigV1Schema,
} from "@nervekit/contracts";
import { stringify } from "yaml";

export function materializeSandboxConfig(config: SandboxConfigV1): string {
  const parsed = sandboxConfigV1Schema.parse(config);
  return stringify(parsed, { sortMapEntries: true });
}

export function parseSandboxConfigInput(input: unknown): SandboxConfigV1 {
  return sandboxConfigV1Schema.parse(input);
}
