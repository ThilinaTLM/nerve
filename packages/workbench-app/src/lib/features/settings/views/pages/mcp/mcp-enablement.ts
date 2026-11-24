import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { McpServerEntry } from "@nervekit/contracts/mcp";
import type { Layered } from "../../../state/layered";

const escape = (value: string) =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");

/** The pointer of a server's choice, for resets. */
export const mcpEnabledPointer = (name: string) =>
  `/overrides/mcpServers/servers/${escape(name)}`;

/** A layer's own decision for a server: its named entry, else that layer's `defaults`. */
export function mcpDecision(
  overrides: LeadSettingsOverrides,
  name: string,
): boolean | undefined {
  const settings = overrides.mcpServers;
  const named = settings?.servers;
  return (
    (named && Object.hasOwn(named, name) ? named[name] : undefined) ??
    settings?.defaults
  );
}

/** The entry's own default: below every layer; absent means on. */
export const mcpEntryDefault = (entry: Pick<McpServerEntry, "enabled">) =>
  entry.enabled ?? true;

/**
 * The layers of one server's switch. A project's own server has no User
 * switch, but the user's decision still applies to it, so it becomes the
 * default the project inherits.
 */
export function mcpEnablementLayers(input: {
  entry: Pick<McpServerEntry, "enabled">;
  user: LeadSettingsOverrides;
  project?: LeadSettingsOverrides;
  name: string;
  projectOwned: boolean;
}): { value: Layered<boolean>; user: boolean; project: boolean } {
  const entryDefault = mcpEntryDefault(input.entry);
  const userChoice = mcpDecision(input.user, input.name);
  const user = userChoice ?? entryDefault;
  const projectChoice = input.project
    ? mcpDecision(input.project, input.name)
    : undefined;
  return {
    value: input.projectOwned
      ? { builtinDefault: user, project: projectChoice }
      : {
          builtinDefault: entryDefault,
          user: userChoice,
          project: projectChoice,
        },
    user,
    project: projectChoice ?? user,
  };
}
