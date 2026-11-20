/**
 * What a script may do to the project's launch catalog (`.nerve/launches/definitions.json`): list
 * it and change it through the same service the app uses. The host fills ids, timestamps, scope
 * and order, and serializes writes.
 */

export type LaunchRunPolicy = "single" | "concurrent";

export type LaunchEntryDefinition = {
  id: string;
  label?: string;
  command: string;
  cwd?: string;
  port?: number;
  runPolicy: LaunchRunPolicy;
  /** Id of the containing folder; null at the top level. */
  folder: string | null;
  order: number;
};

export type LaunchEntryFolder = {
  id: string;
  label: string;
  folder: string | null;
  order: number;
};

export type LaunchesCatalog = {
  definitions: LaunchEntryDefinition[];
  folders: LaunchEntryFolder[];
};

/** Fields of a definition the agent decides. `null` clears an optional field on update. */
export type LaunchDefinitionInput = {
  label?: string | null;
  command?: string;
  cwd?: string | null;
  port?: number | null;
  runPolicy?: LaunchRunPolicy;
};

export type LaunchPlacement = {
  /** Folder id; omitted or null: the top level. */
  folder?: string | null;
  /** Id of the sibling to insert before; omitted: last. */
  before?: string;
};

export interface LaunchesAgentPort {
  list(): Promise<LaunchesCatalog>;
  create(
    input: LaunchDefinitionInput & { command: string } & LaunchPlacement,
  ): Promise<LaunchEntryDefinition>;
  update(
    id: string,
    input: LaunchDefinitionInput,
  ): Promise<LaunchEntryDefinition>;
  remove(id: string): Promise<{ ok: true }>;
  createFolder(
    input: { label: string } & LaunchPlacement,
  ): Promise<LaunchEntryFolder>;
  move(id: string, placement: LaunchPlacement): Promise<{ ok: true }>;
}
