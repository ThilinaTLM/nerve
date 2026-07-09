import { readFile } from "node:fs/promises";
import { type SandboxConfigV1, sandboxConfigV1Schema } from "@nervekit/shared";
import { parse as parseYaml } from "yaml";

export const defaultSandboxConfigPath = "/etc/nerve/sandbox.yaml";

export class SandboxConfigLoadError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SandboxConfigLoadError";
  }
}

export function resolveSandboxConfigPath(env = process.env): string {
  return env.NERVE_SANDBOX_AGENT_CONFIG?.trim() || defaultSandboxConfigPath;
}

export async function loadSandboxConfig(
  path: string,
): Promise<SandboxConfigV1> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new SandboxConfigLoadError(
      `Unable to read sandbox config at ${path}`,
      10,
      error,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new SandboxConfigLoadError(
      `Unable to parse sandbox YAML config at ${path}`,
      10,
      error,
    );
  }

  const result = sandboxConfigV1Schema.safeParse(parsed);
  if (!result.success) {
    throw new SandboxConfigLoadError(
      `Invalid sandbox config at ${path}: ${result.error.message}`,
      10,
      result.error,
    );
  }
  return result.data;
}
