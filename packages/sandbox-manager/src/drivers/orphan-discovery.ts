import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ManagedContainerRef } from "@nervekit/shared";

const execFileAsync = promisify(execFile);
export type OrphanDiscoveryBackend =
  | "auto"
  | "docker"
  | "podman"
  | "podman-wsl";

export async function discoverOrphanContainers(
  backend: OrphanDiscoveryBackend = "docker",
): Promise<ManagedContainerRef[]> {
  if (backend === "auto") {
    const [docker, podman, podmanWsl] = await Promise.all([
      discoverOrphanContainersForBin("docker", ["docker"]),
      discoverOrphanContainersForBin("podman", ["podman"]),
      discoverOrphanContainersForBin("podman-wsl", ["wsl.exe", "--", "podman"]),
    ]);
    return [...docker, ...podman, ...podmanWsl];
  }
  if (backend === "podman-wsl")
    return discoverOrphanContainersForBin(backend, ["wsl.exe", "--", "podman"]);
  return discoverOrphanContainersForBin(backend, [backend]);
}

async function discoverOrphanContainersForBin(
  kind: Exclude<OrphanDiscoveryBackend, "auto">,
  command: string[],
): Promise<ManagedContainerRef[]> {
  const [bin, ...prefix] = command;
  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        ...prefix,
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
        return { kind, id, name };
      });
  } catch {
    return [];
  }
}
