import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ARTIFACT_PREFIX } from "@nervekit/extension-api/host";
import { executeFind } from "../../../execution/filesystem/find.js";
import { executeGrep } from "../../../execution/filesystem/search.js";
import { resolveToolPath } from "../../../execution/index.js";
import { normalizeLineEndings } from "../../../execution/filesystem/text-editing.js";
import { formatByteSize } from "../../../execution/output/format-bytes.js";
import { SCRIPT_EDIT_MAX_BYTES, SCRIPT_EDIT_MAX_FILES } from "../../limits.js";
import { defineMethod } from "../sdk-args.js";
import type {
  MethodAuthorization,
  SdkEnvironment,
  SdkMethod,
} from "../sdk-types.js";
import { MAX_FILE_BYTES, readFileRef } from "./artifacts.js";
import { editResult } from "./edit-result.js";
import {
  applyFileEdits,
  type EditFile,
  fileVersion,
  type PlannedEdit,
} from "./file-edits.js";
import {
  editNeedle,
  editReplacement,
  type ParsedEdit,
  parseEdit,
} from "./text-edits.js";

/** `files.*`: the workspace's files, each call checked as the matching direct tool. */

// Both defaults equal the number of items a printed array shows (`PRINT_ROWS`), so a default call prints whole.
const LIST_LIMIT = 100;
const SEARCH_LIMIT = 100;
const MAX_LIMIT = 2000;

/** A workspace path relative to the cwd when inside it, absolute otherwise. */
function shownPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    ? rel.split(sep).join("/")
    : path;
}

function workspacePath(value: unknown, label: string, env: SdkEnvironment) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty workspace path.`);
  if (value.startsWith(ARTIFACT_PREFIX))
    throw new Error(
      `${value} is an artifact; use artifacts.* for artifacts and files.* for workspace paths.`,
    );
  const path = resolveToolPath(env.context.cwd, value);
  return { path, shown: shownPath(env.context.cwd, path) };
}

function limitOf(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1)
    throw new Error("limit must be a positive integer.");
  return Math.min(value as number, MAX_LIMIT);
}

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
  return value;
};

/** Workspace files matching `glob` (a `find` pattern), relative to the cwd. */
async function findPaths(
  env: SdkEnvironment,
  glob: string,
  path: string | undefined,
  limit: number,
): Promise<{ paths: string[]; total: number }> {
  const found = await executeFind(
    { pattern: glob, ...(path ? { path } : {}), limit },
    { cwd: env.context.cwd, signal: env.context.signal },
  );
  const root = found.path ?? env.context.cwd;
  const total = Number(
    (found.details as { totalEntries?: number } | undefined)?.totalEntries ??
      found.entries?.length ??
      0,
  );
  return {
    paths: (found.entries ?? []).map((entry) =>
      shownPath(env.context.cwd, resolve(root, entry.path)),
    ),
    total,
  };
}

function limitNote(
  env: SdkEnvironment,
  method: string,
  shown: number,
  total: number,
  limit: number,
) {
  if (shown >= limit)
    env.report.notes.push(
      `${method}: showing the first ${shown}${total > shown ? ` of ${total}` : ""}; narrow the query or raise limit (max ${MAX_LIMIT}).`,
    );
}

type EditOptions = {
  /** `stage` and `commit` are the two calls of a `transform`: read the files, then write what the script computed. */
  mode: "edits" | "stage" | "commit";
  planned: (PlannedEdit & { target: string })[];
  dryRun: boolean;
};

/** Stands for a `transform` in the authorization record while its result is not known yet. */
const WHOLE_FILE: ParsedEdit = {
  index: 0,
  edit: { kind: "whole", text: "(transform)" },
};

/** The `path` or `glob` of an edit or of the call; both at once is an error. */
function targetOf(
  record: Record<string, unknown>,
  label: string,
): { target: string; glob?: string } | undefined {
  const keys = (["path", "glob"] as const).filter(
    (key) => record[key] !== undefined,
  );
  if (keys.length === 0) return undefined;
  if (keys.length > 1)
    throw new Error(`${label} takes path or glob, not both.`);
  const target = record[keys[0]];
  if (typeof target !== "string" || !target.trim())
    throw new Error(`${label}.${keys[0]} must be a non-empty string.`);
  return { target, ...(keys[0] === "glob" ? { glob: target } : {}) };
}

/** The files a `transform` will see: text with `\n` line endings and no BOM, as the edits see it. */
async function readForTransform(files: readonly EditFile[]) {
  const staged: { path: string; text: string; version: string }[] = [];
  let total = 0;
  for (const file of files) {
    const bytes = await readFileRef({
      kind: "workspace",
      path: file.path,
      handle: file.shown,
    });
    total += bytes.byteLength;
    if (total > SCRIPT_EDIT_MAX_BYTES)
      throw new Error(
        `the files exceed ${formatByteSize(SCRIPT_EDIT_MAX_BYTES)} per call. Narrow the glob.`,
      );
    const raw = bytes.toString("utf8");
    if (raw.includes("\0"))
      throw new Error(`${file.shown} appears to be a binary file.`);
    staged.push({
      path: file.shown,
      text: normalizeLineEndings(raw.replace(/^\uFEFF/, "")),
      version: fileVersion(raw),
    });
  }
  return staged;
}

export const filesMethods: SdkMethod[] = [
  defineMethod({
    product: "files",
    path: "list",
    risk: "read",
    bare: "glob",
    options: ["glob", "path", "limit"],
    signature:
      '/** Workspace files matching a glob, relative to the cwd; .gitignore applies. A glob with "/" matches the path, otherwise the file name. limit default 100, max 2000. */ list(glob: string | { glob: string; path?: string; limit?: number }): Promise<string[]>',
    parse: (options) => {
      const glob = optionalString(options.glob, "glob");
      if (!glob) throw new Error("glob must be a non-empty string.");
      return {
        glob,
        path: optionalString(options.path, "path"),
        limit: limitOf(options.limit, LIST_LIMIT),
      };
    },
    authorize: ({ glob, path }, env) => ({
      toolName: "find",
      args: { pattern: glob, ...(path ? { path } : {}) },
      summary: `${glob}${path ? ` in ${shownPath(env.context.cwd, resolveToolPath(env.context.cwd, path))}` : ""}`,
    }),
    async run({ glob, path, limit }, env) {
      const found = await findPaths(env, glob, path, limit);
      limitNote(env, "files.list", found.paths.length, found.total, limit);
      return found.paths;
    },
  }),
  defineMethod({
    product: "files",
    path: "search",
    risk: "read",
    bare: "pattern",
    options: ["pattern", "literal", "ignoreCase", "glob", "path", "limit"],
    signature:
      "/** Matching lines in workspace files (ripgrep regex unless literal); .gitignore applies. limit default 100, max 2000. */ search(pattern: string | { pattern: string; literal?: boolean; ignoreCase?: boolean; glob?: string; path?: string; limit?: number }): Promise<FileMatch[]>",
    parse: (options) => {
      const pattern = optionalString(options.pattern, "pattern");
      if (!pattern) throw new Error("pattern must be a non-empty string.");
      for (const flag of ["literal", "ignoreCase"] as const)
        if (options[flag] !== undefined && typeof options[flag] !== "boolean")
          throw new Error(`${flag} must be a boolean.`);
      return {
        pattern,
        literal: options.literal === true,
        ignoreCase: options.ignoreCase === true,
        glob: optionalString(options.glob, "glob"),
        path: optionalString(options.path, "path"),
        limit: limitOf(options.limit, SEARCH_LIMIT),
      };
    },
    authorize: ({ pattern, glob, path }) => ({
      toolName: "grep",
      args: { pattern, ...(glob ? { glob } : {}), ...(path ? { path } : {}) },
      summary: pattern,
    }),
    async run({ pattern, literal, ignoreCase, glob, path, limit }, env) {
      const found = await executeGrep(
        {
          pattern,
          literal,
          ignoreCase,
          limit,
          ...(glob ? { glob } : {}),
          ...(path ? { path } : {}),
        },
        { cwd: env.context.cwd, signal: env.context.signal },
      );
      const root = found.path ?? env.context.cwd;
      const matches = (found.matches ?? []).map((match) => ({
        path: shownPath(env.context.cwd, resolve(root, match.path)),
        line: match.line,
        text: match.text,
      }));
      limitNote(
        env,
        "files.search",
        matches.length,
        Number(
          (found.details as { totalMatches?: number } | undefined)
            ?.totalMatches ?? matches.length,
        ),
        limit,
      );
      return matches;
    },
  }),
  defineMethod({
    product: "files",
    path: "read",
    risk: "read",
    bare: "path",
    options: ["path", "as"],
    signature:
      '/** A workspace file as text (default) or bytes; max 20 MB. */ read(path: string | { path: string; as?: "text" }): Promise<string>; read(options: { path: string; as: "bytes" }): Promise<Uint8Array>',
    parse: (options) => {
      const as = options.as ?? "text";
      if (as !== "text" && as !== "bytes")
        throw new Error('as must be "text" or "bytes".');
      return { path: options.path, as };
    },
    authorize: ({ path }, env) => {
      const file = workspacePath(path, "path", env);
      return {
        toolName: "read",
        args: { path: file.path },
        summary: file.shown,
      };
    },
    resource: ({ path }) => String(path),
    async run({ path, as }, env) {
      const file = workspacePath(path, "path", env);
      const bytes = await readFileRef({
        kind: "workspace",
        path: file.path,
        handle: file.shown,
      });
      // Bytes cross the JSON bridge as base64; the prelude decodes them to a Uint8Array.
      return as === "bytes"
        ? { encoding: "base64", data: bytes.toString("base64") }
        : bytes.toString("utf8");
    },
  }),
  defineMethod({
    product: "files",
    path: "write",
    risk: "write",
    options: ["path", "data"],
    signature:
      "/** Creates or overwrites a workspace file, creating its folders; max 20 MB. Returns the path. */ write(options: { path: string; data: string | Uint8Array | ArrayBuffer }): Promise<string>",
    parse: (options) => ({
      path: options.path,
      bytes: payloadBytes(options.data),
    }),
    // Content is irrelevant to path policy and can be large; the schema only needs it present.
    authorize: ({ path }, env) => {
      const file = workspacePath(path, "path", env);
      return {
        toolName: "write",
        args: { path: file.path, content: "" },
        summary: file.shown,
      };
    },
    resource: ({ path }) => String(path),
    async run({ path, bytes }, env) {
      const file = workspacePath(path, "path", env);
      const existed = await stat(file.path).then(
        () => true,
        () => false,
      );
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, bytes);
      (existed ? env.report.updated : env.report.created).push(
        `file ${file.shown}`,
      );
      return file.shown;
    },
  }),
  defineMethod({
    product: "files",
    path: "edit",
    risk: "write",
    // `stage` and `contents` are the two calls the prelude makes for `transform`.
    options: [
      "edits",
      "path",
      "glob",
      "dryRun",
      "transform",
      "stage",
      "contents",
    ],
    signature:
      "/** Edits workspace files: each edit applies in list order to its `path` or `glob` (default: the call's). Every match count is checked before anything is written; all files change or none. `transform` instead maps each file's text to its new text (undefined: unchanged). */ edit(options: { path?: string; glob?: string; dryRun?: boolean } & ({ edits: (TextEdit & { path?: string; glob?: string })[] } | { transform: (text: string, path: string) => string | undefined })): Promise<EditResult>",
    parse: (options): EditOptions => {
      const { edits, dryRun } = options;
      if (dryRun !== undefined && typeof dryRun !== "boolean")
        throw new Error("dryRun must be a boolean.");
      const shared = targetOf(options, "files.edit");
      if (options.transform !== undefined && options.stage !== true)
        throw new Error("transform must be a function.");
      if (options.stage === true || options.contents !== undefined) {
        if (edits !== undefined)
          throw new Error(
            "transform cannot be combined with edits: make two files.edit calls, or do all of it in transform.",
          );
        if (options.stage === true) {
          if (!shared)
            throw new Error("transform needs a path or glob next to it.");
          return {
            mode: "stage",
            dryRun: false,
            planned: [
              {
                parsed: WHOLE_FILE,
                files: [],
                ...shared,
              },
            ],
          };
        }
        if (!Array.isArray(options.contents))
          throw new Error("contents must be an array.");
        return {
          mode: "commit",
          dryRun: dryRun === true,
          planned: options.contents.map((raw) => {
            const { path, text, version } = (raw ?? {}) as Record<
              string,
              unknown
            >;
            if (
              typeof path !== "string" ||
              typeof text !== "string" ||
              typeof version !== "string"
            )
              throw new Error("transform must return a string or undefined.");
            return {
              parsed: {
                index: 0,
                edit: { kind: "whole", text: normalizeLineEndings(text) },
              },
              files: [],
              target: path,
              version,
            };
          }),
        };
      }
      if (!Array.isArray(edits) || edits.length === 0)
        throw new Error("edits must be a non-empty array.");
      return {
        mode: "edits",
        dryRun: dryRun === true,
        planned: edits.map((raw, index) => {
          const parsed = parseEdit(raw, index, ["path", "glob"]);
          const target =
            targetOf(raw as Record<string, unknown>, `edits[${index}]`) ??
            shared;
          if (!target)
            throw new Error(
              `edits[${index}] needs a path or glob, on the edit or on the call.`,
            );
          return { parsed, files: [], ...target };
        }),
      };
    },
    // Resolves globs here, so every file is checked as the direct `edit` tool before the call runs.
    authorizeAlso: async ({ planned }, env) => {
      for (const edit of planned) {
        if (edit.glob === undefined) {
          edit.files = [
            workspacePath(edit.target, `edits[${edit.parsed.index}].path`, env),
          ];
          continue;
        }
        const found = await findPaths(
          env,
          edit.glob,
          undefined,
          SCRIPT_EDIT_MAX_FILES + 1,
        );
        if (found.paths.length === 0)
          throw new Error(
            `glob ${JSON.stringify(edit.glob)} matches no files.`,
          );
        if (found.paths.length > SCRIPT_EDIT_MAX_FILES)
          throw new Error(
            `glob ${JSON.stringify(edit.glob)} matches more than ${SCRIPT_EDIT_MAX_FILES} files; narrow it.`,
          );
        edit.files = found.paths.map((path) =>
          workspacePath(path, "glob", env),
        );
      }
      const byPath = new Map<
        string,
        { file: EditFile; edits: { oldText: string; newText: string }[] }
      >();
      for (const edit of planned)
        for (const file of edit.files) {
          const entry = byPath.get(file.path) ?? { file, edits: [] };
          entry.edits.push({
            oldText: editNeedle(edit.parsed.edit),
            newText: editReplacement(edit.parsed.edit),
          });
          byPath.set(file.path, entry);
        }
      return [...byPath.values()].map(
        ({ file, edits }): MethodAuthorization => ({
          toolName: "edit",
          args: { path: file.path, edits },
          summary: file.shown,
        }),
      );
    },
    resource: ({ planned }) =>
      [...new Set(planned.map((edit) => edit.target))].join(", "),
    async run({ mode, planned, dryRun }, env) {
      if (mode === "stage")
        return { staged: await readForTransform(planned[0].files) };
      const outcome = await applyFileEdits(planned, {
        dryRun,
        notFoundHint: "Create it with files.write.",
      });
      for (const { file } of outcome.written)
        env.report.updated.push(`file ${file.shown}`);
      return await editResult(outcome, env, dryRun, mode === "edits");
    },
  }),
];

/** `data` as the prelude sends it: `{ text }` or `{ base64 }`. */
export function payloadBytes(data: unknown): Buffer {
  const payload = data as { text?: unknown; base64?: unknown } | undefined;
  let bytes: Buffer;
  if (typeof payload?.text === "string")
    bytes = Buffer.from(payload.text, "utf8");
  else if (typeof payload?.base64 === "string")
    bytes = Buffer.from(payload.base64, "base64");
  else throw new Error("data must be a string, Uint8Array or ArrayBuffer.");
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new Error(
      `data is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}.`,
    );
  return bytes;
}
