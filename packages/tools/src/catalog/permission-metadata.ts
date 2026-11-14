import type {
  PermissionTargetKind,
  StaticToolRisk,
  ToolKind,
} from "@nervekit/contracts/permissions";
import type { ToolName } from "@nervekit/contracts/tools";

export interface ToolPermissionMetadata {
  kind: ToolKind;
  groups: readonly string[];
  baseRisk: StaticToolRisk;
  primaryArguments: readonly string[];
  targetKinds: readonly PermissionTargetKind[];
  primaryTargetComplete: boolean;
}

const metadata = {
  read: m("filesystem", "fileInspection", "read", ["path"], ["path"], true),
  bash: m("command", "shell", "unknown", ["command"], ["whole_tool"], true),
  python_exec: m(
    "code",
    "python",
    "unknown",
    ["code", "path"],
    ["whole_tool"],
    true,
  ),
  edit: m("filesystem", "fileEditing", "write", ["path"], ["path"], true),
  write: m("filesystem", "fileEditing", "write", ["path"], ["path"], true),
  grep: m(
    "filesystem",
    "fileInspection",
    "read",
    ["paths", "path"],
    ["path"],
    false,
  ),
  find: m("filesystem", "fileInspection", "read", ["path"], ["path"], true),
  ls: m("filesystem", "fileInspection", "read", ["path"], ["path"], true),
  ask_user: m(
    "interaction",
    "input",
    "interaction",
    ["question"],
    ["whole_tool"],
    true,
  ),
  todos_set: m("interaction", "todos", "interaction", [], ["whole_tool"], true),
  todos_get: m("interaction", "todos", "read", [], ["whole_tool"], true),
  web_fetch: m("network", "web", "network", ["url"], ["url"], true),
  explain_image: m("network", "vision", "network", ["path"], ["path"], true),
  quick_script: m(
    "integration",
    "quickScript",
    "network",
    ["code"],
    ["whole_tool"],
    true,
  ),
  async_bash: m(
    "orchestration",
    "process",
    "unknown",
    ["action", "id"],
    ["whole_tool"],
    true,
  ),
  launch: m(
    "orchestration",
    "process",
    "unknown",
    ["action", "name", "runId"],
    ["whole_tool"],
    true,
  ),
  subagent_prompt: m(
    "orchestration",
    "subagents",
    "agent_spawn",
    ["assignments"],
    ["whole_tool"],
    true,
  ),
  subagent_status: m(
    "orchestration",
    "subagents",
    "read",
    ["name"],
    ["whole_tool"],
    true,
  ),
  subagent_stop: m(
    "orchestration",
    "subagents",
    "agent_spawn",
    ["names"],
    ["whole_tool"],
    true,
  ),
  plan_present: m(
    "orchestration",
    "planMode",
    "interaction",
    ["file_path"],
    ["path"],
    true,
  ),
} satisfies Record<ToolName, ToolPermissionMetadata>;

function m(
  kind: ToolKind,
  group: string,
  baseRisk: StaticToolRisk,
  primaryArguments: readonly string[],
  targetKinds: readonly PermissionTargetKind[],
  primaryTargetComplete: boolean,
): ToolPermissionMetadata {
  return Object.freeze({
    kind,
    groups: Object.freeze([group]),
    baseRisk,
    primaryArguments: Object.freeze(primaryArguments),
    targetKinds: Object.freeze(targetKinds),
    primaryTargetComplete,
  });
}

export const toolPermissionMetadata: Readonly<
  Record<ToolName, ToolPermissionMetadata>
> = Object.freeze(metadata);

const extensionToolMetadata = new Map<string, ToolPermissionMetadata>();

/** Records the permission metadata of an extension's tool (see `registerToolDefinitions`). */
export function registerExtensionToolMetadata(
  name: string,
  metadata: ToolPermissionMetadata,
): void {
  if (name in toolPermissionMetadata)
    throw new Error(`Duplicate tool definition: ${name}`);
  extensionToolMetadata.set(name, Object.freeze({ ...metadata }));
}

export function permissionMetadataForTool(
  name: ToolName,
): ToolPermissionMetadata {
  const metadata =
    toolPermissionMetadata[name] ?? extensionToolMetadata.get(name);
  if (!metadata) throw new Error(`Unknown tool: ${name}`);
  return metadata;
}
