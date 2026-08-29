import { parseSlashCommand } from "@nervekit/contracts/completions";
import { type Mode } from "@nervekit/contracts/settings";

export type ComposerSlashCommandActions = {
  clearComposer: () => void;
  setMode: (mode: Mode) => void;
  compact: () => void | Promise<void>;
  abort: () => void | Promise<void>;
};

export async function executeComposerSlashCommand(
  text: string,
  actions: ComposerSlashCommandActions,
): Promise<boolean> {
  const command = parseSlashCommand(text);
  if (!command) return false;

  actions.clearComposer();
  switch (command.name) {
    case "plan":
      actions.setMode("planning");
      break;
    case "code":
      actions.setMode("coding");
      break;
    case "compact":
      await actions.compact();
      break;
    case "abort":
      await actions.abort();
      break;
  }
  return true;
}
