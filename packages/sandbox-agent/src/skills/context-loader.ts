import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ContextFileStatus, SandboxConfigV1 } from "@nervekit/contracts";
export async function loadContextFiles(
  config: SandboxConfigV1,
  workspaceDir: string,
): Promise<ContextFileStatus[]> {
  const names = config.skills?.contextFiles?.names ?? ["AGENTS.md"];
  const statuses: ContextFileStatus[] = [];
  for (const name of names) {
    const filePath = path.join(workspaceDir, name);
    try {
      await access(filePath);
      const raw = await readFile(filePath);
      statuses.push({
        path: filePath,
        digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
        bytes: raw.byteLength,
        included: true,
      });
    } catch {
      statuses.push({ path: filePath, included: false });
    }
  }
  return statuses;
}
