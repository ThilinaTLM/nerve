import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ManagedContainerRef } from "@nervekit/shared";

const execFileAsync = promisify(execFile);
export async function discoverOrphanContainers(
  bin: "docker" | "podman" = "docker",
): Promise<ManagedContainerRef[]> {
  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        "ps",
        "-a",
        "--filter",
        "label=org.nerve.sandbox.spec=v1",
        "--format",
        "{{.ID}} {{.Names}}",
      ],
      { timeout: 5_000 },
    );
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [id, name] = line.split(/\s+/, 2);
        return { kind: bin, id, name };
      });
  } catch {
    return [];
  }
}
