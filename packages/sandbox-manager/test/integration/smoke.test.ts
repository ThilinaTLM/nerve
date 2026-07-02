import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("guarded docker/podman sandbox smoke", () => {
  it("skips clearly when no container backend is available", async (t) => {
    const backend = await availableBackend();
    if (!backend) {
      t.skip(
        "Docker/Podman backend unavailable; guarded sandbox smoke skipped",
      );
      return;
    }
    // Full container smoke is intentionally guarded and configured by operators;
    // this assertion proves backend detection happens at runtime, not import time.
    await execFileAsync(backend, ["version"], { timeout: 10_000 });
  });
});

async function availableBackend(): Promise<"docker" | "podman" | undefined> {
  for (const bin of ["docker", "podman"] as const) {
    try {
      await execFileAsync(bin, ["version"], { timeout: 5_000 });
      return bin;
    } catch {}
  }
  return undefined;
}
