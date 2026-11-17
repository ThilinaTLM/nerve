import { CliError, defineCli } from "../cli/main.ts";
import { assertWorkspaceVersionsMatch } from "../release/workspace-packages.ts";

// The packages published on their own (extension-api, ui-kit, extension-sdk) and every other
// release package carry the root version: it tracks extension compatibility. `pnpm release:tag`
// bumps them together; this catches a hand edit that breaks the lockstep.
await defineCli(import.meta.url, async () => {
  try {
    await assertWorkspaceVersionsMatch();
  } catch (cause) {
    throw new CliError(cause instanceof Error ? cause.message : String(cause));
  }
});
