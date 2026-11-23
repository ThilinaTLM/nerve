import type {
  LaunchesAgentPort,
  LaunchEntryDefinition,
  LaunchEntryFolder,
  LaunchPlacement,
  LaunchSelector,
} from "@nervekit/tools/quick-script";
import {
  createLaunchDefinitionRequestSchema,
  updateLaunchDefinitionRequestSchema,
  type LaunchCatalogEntryRef,
  type LaunchDefinition,
  type LaunchFolder,
} from "@nervekit/contracts/launch-definitions";
import { isAbsolute, relative, sep } from "node:path";
import type { Project } from "@nervekit/contracts/core";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import { ApplicationError } from "../../core/application-error.js";
import type { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import {
  definitionName,
  runName,
  toLaunchRun,
  type LaunchCaller,
  type LaunchRuns,
} from "../launch-runs.js";

const HINTS: Record<string, string> = {
  LAUNCH_CATALOG_ENTRY_NOT_FOUND:
    "No definition or folder has this name. Call launches.list() for the names.",
  LAUNCH_FOLDER_NOT_FOUND:
    "No folder has this name. Call launches.list() for the names, or create it with launches.folders.create().",
  LAUNCH_FOLDER_NAME_CONFLICT: "Pick another folder name.",
  LAUNCH_FOLDER_INVALID_NAME: "Give the folder a name.",
  LAUNCH_CATALOG_INVALID_MOVE: "Move it into a folder that is not inside it.",
  LAUNCH_CATALOG_INVALID_ANCHOR:
    "`before` must be a sibling in the destination `folder`; check launches.list().",
  LAUNCH_CATALOG_CONFLICT: "The catalog changed meanwhile. Call it again.",
  LAUNCH_CATALOG_BUSY: "Another change is in progress. Call it again.",
};

function reword(error: unknown): never {
  if (error instanceof ApplicationError)
    throw new Error(`${error.message} ${HINTS[error.code] ?? ""}`.trim());
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (
      error as { issues: { path: PropertyKey[]; message: string }[] }
    ).issues;
    throw new Error(
      `Invalid launch definition: ${issues
        .map(
          (issue) =>
            `${issue.path.map(String).join(".") || "input"}: ${issue.message}`,
        )
        .join("; ")}.`,
    );
  }
  throw error;
}

type Catalog = { definitions: LaunchDefinition[]; folders: LaunchFolder[] };

/** No entry has the name or id (as opposed to an ambiguous name). */
class LaunchNotFoundError extends Error {}

const quoted = (value: string) => JSON.stringify(value);

function where(catalog: Catalog, folderId: string | null): string {
  const folder = catalog.folders.find((item) => item.id === folderId);
  return folder ? `in folder ${quoted(folder.label)}` : "at the top level";
}

function ambiguous(
  catalog: Catalog,
  name: string,
  matches: readonly (LaunchDefinition | LaunchFolder)[],
): Error {
  return new Error(
    `${matches.length} entries are named ${quoted(name)}: ${matches
      .map((item) => `${item.id} (${where(catalog, item.parentFolderId)})`)
      .join(
        ", ",
      )}. Pass the id instead, or ask the user to rename one so the names differ.`,
  );
}

function unknownName(
  catalog: Catalog,
  name: string,
  kind: "launch" | "folder" | "entry",
): Error {
  const names = [
    ...(kind !== "folder" ? catalog.definitions.map(definitionName) : []),
    ...(kind !== "launch" ? catalog.folders.map((item) => item.label) : []),
  ];
  return new LaunchNotFoundError(
    `No ${kind === "entry" ? "launch or folder" : kind} is named ${quoted(name)}. ${
      names.length
        ? `Names: ${[...new Set(names)].slice(0, 30).map(quoted).join(", ")}.`
        : "The project has none; call launches.list()."
    }`,
  );
}

/** A definition or folder by id, or by the name the user sees (exact, after trimming). */
function findEntry(
  catalog: Catalog,
  name: string,
  kind: "launch" | "folder" | "entry",
  among?: (item: LaunchDefinition | LaunchFolder) => boolean,
): LaunchCatalogEntryRef {
  const value = name.trim();
  const definitions = kind === "folder" ? [] : catalog.definitions;
  const folders = kind === "launch" ? [] : catalog.folders;
  const keep = among ?? (() => true);
  const byId =
    definitions.find((item) => item.id === value) ??
    folders.find((item) => item.id === value);
  if (byId)
    return {
      kind: "command" in byId ? "definition" : "folder",
      id: byId.id,
    };
  if (value.startsWith("launchfolder_") && kind === "launch")
    throw new Error(
      `${quoted(value)} is a folder; this call takes a launch definition.`,
    );
  const matches = [
    ...definitions.filter(
      (item) => keep(item) && definitionName(item) === value,
    ),
    ...folders.filter((item) => keep(item) && item.label.trim() === value),
  ];
  if (matches.length > 1) throw ambiguous(catalog, value, matches);
  const [match] = matches;
  if (!match)
    throw /^launch(def|folder)_/.test(value)
      ? new LaunchNotFoundError(
          `No ${kind === "folder" ? "folder" : "entry"} has the id ${quoted(value)}. Call launches.list() for the names and ids.`,
        )
      : unknownName(catalog, value, kind);
  return {
    kind: "command" in match ? "definition" : "folder",
    id: match.id,
  };
}

const asDefinition = (definition: LaunchDefinition): LaunchEntryDefinition => ({
  id: definition.id,
  name: definitionName(definition),
  ...(definition.label !== undefined ? { label: definition.label } : {}),
  command: definition.command,
  ...(definition.cwd !== undefined ? { cwd: definition.cwd } : {}),
  ...(definition.port !== undefined ? { port: definition.port } : {}),
  runPolicy: definition.runPolicy,
  folder: definition.parentFolderId,
  order: definition.order,
});

const asFolder = (folder: LaunchFolder): LaunchEntryFolder => ({
  id: folder.id,
  label: folder.label,
  folder: folder.parentFolderId,
  order: folder.order,
});

/**
 * The `launches.*` quick_script namespace for one project and conversation: the app's own
 * `LaunchDefinitionService` writes the catalog (lock, ids, timestamps, order), so the agent never
 * edits `definitions.json`, and `LaunchRuns` starts and stops runs. Entries are named by the
 * labels the user sees; ids settle ambiguous names. Failures say what to fix.
 */
export function createLaunchesAgentPort(options: {
  definitions: Pick<
    LaunchDefinitionService,
    | "catalog"
    | "problem"
    | "create"
    | "update"
    | "remove"
    | "createFolder"
    | "move"
  >;
  /** Read on first use, so scripts that never touch launches do not need the project. */
  project: () => Project;
  runs: LaunchRuns;
  caller: LaunchCaller;
  /** The shell launches run in; absent: none is usable. */
  shell: { available: true; path: string } | { available: false };
}): LaunchesAgentPort {
  const { definitions, runs, caller } = options;
  let resolved: Project | undefined;
  const project = () => (resolved ??= options.project());
  const projectId = () => project().id;

  async function problem(): Promise<string | undefined> {
    const found = await definitions.problem(projectId());
    return found && `${found.path} is invalid (${found.reason})`;
  }

  /** An invalid file reads as an empty catalog: refuse instead of writing over it. */
  async function revision(): Promise<string> {
    const found = await problem();
    if (found)
      throw new Error(
        `${found}, so the project has no launch definitions and changes are refused. Fix the file (JSON Schema in the configure-nerve skill), then check it with configuration.check("project").`,
      );
    return (await definitions.catalog(projectId())).revision;
  }

  async function write<T>(
    action: (revision: string, catalog: Catalog) => Promise<T>,
  ): Promise<T> {
    try {
      const expected = await revision();
      return await action(expected, await definitions.catalog(projectId()));
    } catch (error) {
      return reword(error);
    }
  }

  function destination(catalog: Catalog, placement: LaunchPlacement) {
    const parentFolderId =
      placement.folder === undefined || placement.folder === null
        ? null
        : findEntry(catalog, placement.folder, "folder").id;
    const beforeSibling = placement.before
      ? findEntry(
          catalog,
          placement.before,
          "entry",
          (item) => item.parentFolderId === parentFolderId,
        )
      : null;
    return { parentFolderId, beforeSibling };
  }

  /** The launch a selector names and the run it picks (the latest when no runId). */
  async function select(selector: LaunchSelector): Promise<{
    name: string;
    definition?: LaunchDefinition;
    run?: LaunchRecord;
  }> {
    const records = await runs.list(projectId());
    const unreadable = await problem();
    const catalog: Catalog = unreadable
      ? { definitions: [], folders: [] }
      : await definitions.catalog(projectId());
    const byId = selector.runId
      ? records.find((record) => record.id === selector.runId!.trim())
      : undefined;
    if (selector.runId && !byId)
      throw new Error(
        `This project has no run ${quoted(selector.runId)}. Call launches.list() for run ids.`,
      );
    if (!selector.name) {
      const definition = catalog.definitions.find(
        (item) => item.id === byId!.definitionId,
      );
      return {
        name: definition ? definitionName(definition) : runName(byId!),
        definition,
        run: byId,
      };
    }
    const name = selector.name.trim();
    const definitionIds = new Set(catalog.definitions.map((item) => item.id));
    const standalone = records.filter(
      (record) =>
        (!record.definitionId || !definitionIds.has(record.definitionId)) &&
        runName(record) === name,
    );
    let definition: LaunchDefinition | undefined;
    try {
      const entry = findEntry(catalog, name, "launch");
      definition = catalog.definitions.find((item) => item.id === entry.id);
    } catch (error) {
      // Only a name no definition has falls back to runs of no definition.
      if (!(error instanceof LaunchNotFoundError) || !standalone.length)
        throw unreadable && error instanceof LaunchNotFoundError
          ? new Error(
              `${error.message} The project's launch definitions cannot be read: ${unreadable}. Fix the file, then retry.`,
            )
          : error;
    }
    const matching = definition
      ? records.filter((record) => record.definitionId === definition.id)
      : standalone;
    if (byId && !matching.includes(byId))
      throw new Error(
        `Run ${byId.id} is not a run of ${quoted(name)}; it ran ${quoted(byId.command)}. Call launches.list() for each launch's runs.`,
      );
    const lineages = new Set(
      matching.map((record) => record.restartRootLaunchId ?? record.id),
    );
    if (!definition && !byId && lineages.size > 1)
      throw new Error(
        `Several runs are named ${quoted(name)}: ${matching
          .map((record) => `${record.id} (${quoted(record.command)})`)
          .join(", ")}. Pass the runId.`,
      );
    return {
      name: definition ? definitionName(definition) : name,
      definition,
      run: byId ?? matching[0],
    };
  }

  return {
    async list() {
      await revision();
      const catalog = await definitions.catalog(projectId());
      const records = await runs.list(projectId());
      const ids = new Set(catalog.definitions.map((item) => item.id));
      return {
        definitions: catalog.definitions.map((definition) => ({
          ...asDefinition(definition),
          runs: records
            .filter((record) => record.definitionId === definition.id)
            .map((record) => toLaunchRun(record, definitionName(definition))),
        })),
        folders: catalog.folders.map(asFolder),
        runs: records
          .filter(
            (record) => !record.definitionId || !ids.has(record.definitionId),
          )
          .map((record) => toLaunchRun(record)),
      };
    },
    async prepareStart(selector, mode) {
      const { definition, run } = await select(selector);
      if (!definition && !run)
        throw new Error("Internal error: a selection without a launch.");
      if (!options.shell.available)
        throw new Error(
          "No usable shell is configured, so launches cannot start. Ask the user to set a shell path in Settings → Tools → bash.",
        );
      const prepared = await runs.prepareStart(
        project(),
        definition ? { definition, run } : { run: run! },
        mode,
        caller,
        options.shell.path,
      );
      if (!prepared.process) return prepared;
      // As a bash call names it: relative to the project, absent at its root, absolute outside it.
      const cwd = relative(project().directory, prepared.process.cwd!);
      return {
        ...prepared,
        process: {
          command: prepared.process.command,
          ...(cwd === ""
            ? {}
            : {
                cwd:
                  cwd.startsWith("..") || isAbsolute(cwd)
                    ? prepared.process.cwd
                    : cwd.split(sep).join("/"),
              }),
        },
      };
    },
    async prepareStop(selector) {
      const { name, definition, run } = await select(selector);
      return {
        name,
        target: definition
          ? `launches:launch/${definition.id}`
          : `launches:run/${run!.restartRootLaunchId ?? run!.id}`,
        stop: () => runs.stop(run, name),
      };
    },
    async logs(selector, page) {
      const { name, run } = await select(selector);
      if (!run)
        throw new Error(
          `Launch ${quoted(name)} has not run yet, so it has no output. Start it with launches.start().`,
        );
      return runs.logs(run, page, name);
    },
    create: (input) =>
      write(async (expected, catalog) => {
        const request = createLaunchDefinitionRequestSchema.parse({
          label: input.label ?? undefined,
          command: input.command,
          cwd: input.cwd ?? undefined,
          port: input.port ?? undefined,
          runPolicy: input.runPolicy,
          ...destination(catalog, input),
        });
        return asDefinition(
          (await definitions.create(projectId(), request, expected)).definition,
        );
      }),
    update: (name, input) =>
      write(async (expected, catalog) => {
        const { id } = findEntry(catalog, name, "launch");
        const current = catalog.definitions.find(
          (definition) => definition.id === id,
        )!;
        const pick = <T>(next: T | null | undefined, previous: T | undefined) =>
          next === undefined ? previous : (next ?? undefined);
        const request = updateLaunchDefinitionRequestSchema.parse({
          label: pick(input.label, current.label),
          command: input.command ?? current.command,
          cwd: pick(input.cwd, current.cwd),
          port: pick(input.port, current.port),
          runPolicy: input.runPolicy ?? current.runPolicy,
        });
        return asDefinition(
          (await definitions.update(projectId(), id, request, expected))
            .definition,
        );
      }),
    remove: (name) =>
      write(async (expected, catalog) => {
        let id: string;
        try {
          id = findEntry(catalog, name, "launch").id;
        } catch (error) {
          if (!(error instanceof LaunchNotFoundError)) throw error;
          const folder = catalog.folders.some(
            (item) =>
              item.id === name.trim() || item.label.trim() === name.trim(),
          );
          if (!folder) throw error;
          throw new Error(
            `${quoted(name)} is a folder; launches.remove deletes definitions. Move its entries out and ask the user to delete the folder.`,
            { cause: error },
          );
        }
        await definitions.remove(projectId(), id, expected);
        return { ok: true as const };
      }),
    createFolder: (input) =>
      write(async (expected, catalog) =>
        asFolder(
          (
            await definitions.createFolder(
              projectId(),
              { label: input.label, ...destination(catalog, input) },
              expected,
            )
          ).folder,
        ),
      ),
    move: (name, placement) =>
      write(async (expected, catalog) => {
        const place = destination(catalog, placement);
        await definitions.move(
          projectId(),
          {
            entry: findEntry(catalog, name, "entry"),
            destinationFolderId: place.parentFolderId,
            beforeSibling: place.beforeSibling,
          },
          expected,
        );
        return { ok: true as const };
      }),
  };
}
