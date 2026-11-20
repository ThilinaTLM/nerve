/** Declarations of the `launches` runtime namespace. */
export const LAUNCHES_DTS_TYPES = `interface LaunchDefinition {
  /** "launchdef_...". The \`launch\` tool starts a definition by this id or its label. */
  id: string;
  label?: string;
  command: string;
  /** Relative to the project directory. */
  cwd?: string;
  port?: number;
  runPolicy: "single" | "concurrent";
  /** Containing folder id; null at the top level. */
  folder: string | null;
  /** Position among siblings, 0..n-1. */
  order: number;
}
interface LaunchFolder {
  /** "launchfolder_...". */
  id: string;
  label: string;
  folder: string | null;
  order: number;
}
interface LaunchesCatalog {
  definitions: LaunchDefinition[];
  folders: LaunchFolder[];
}
interface LaunchPlacement {
  /** Folder id; omit or null for the top level. */
  folder?: string | null;
  /** Id of the sibling (definition or folder, same \`folder\`) to insert before; omit to append. */
  before?: string;
}
interface LaunchDefinitionFields {
  label?: string;
  /** Shell command. There is no env field: write variables into the command (\`PORT=3000 pnpm dev\`). */
  command: string;
  cwd?: string;
  port?: number;
  /** Default "single". */
  runPolicy?: "single" | "concurrent";
}`;
