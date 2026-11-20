import { realpath } from "node:fs/promises";
import { resolveBashShellConfig } from "@nervekit/tools/execution";

/** The shell tools run with, or that none is available; the path is resolved to its real file. */
export async function resolveShell(
  shellPath: string | undefined,
): Promise<{ available: true; path: string } | { available: false }> {
  try {
    return {
      available: true,
      path: await realpath(resolveBashShellConfig({ shellPath }).shell),
    };
  } catch {
    return { available: false };
  }
}
