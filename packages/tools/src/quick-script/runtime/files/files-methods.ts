import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ARTIFACT_PREFIX } from "@nervekit/extension-api/host";
import { executeFind } from "../../../execution/filesystem/find.js";
import { executeGrep } from "../../../execution/filesystem/search.js";
import { resolveToolPath } from "../../../execution/index.js";
import { SCRIPT_EDIT_MAX_FILES } from "../../limits.js";
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
  type PlannedEdit,
} from "./file-edits.js";
import { editNeedle, editReplacement, parseEdit } from "./text-edits.js";

/** `files.*`: the workspace's files, each call checked as the matching direct tool. */

const LIST_LIMIT = 200;
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
  planned: (PlannedEdit & { target: string })[];
  dryRun: boolean;
};

export const filesMethods: SdkMethod[] = [
  defineMethod({
    product: "files",
    path: "list",
    risk: "read",
    bare: "glob",
    options: ["glob", "path", "limit"],
    signature:
      '/** Workspace files matching a glob, relative to the cwd; .gitignore applies. A glob with "/" matches the path, otherwise the file name. limit default 200, max 2000. */ list(glob: string | { glob: string; path?: string; limit?: number }): Promise<string[]>',
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
    options: ["edits", "dryRun"],
    signature:
      "/** Edits workspace files: each edit names `path` or `glob` and applies in list order. Every match count is checked before anything is written; all files change or none. */ edit(options: { edits: (TextEdit & ({ path: string } | { glob: string }))[]; dryRun?: boolean }): Promise<EditResult>",
    parse: (options): EditOptions => {
      const { edits, dryRun } = options;
      if (!Array.isArray(edits) || edits.length === 0)
        throw new Error("edits must be a non-empty array.");
      if (dryRun !== undefined && typeof dryRun !== "boolean")
        throw new Error("dryRun must be a boolean.");
      return {
        dryRun: dryRun === true,
        planned: edits.map((raw, index) => {
          const parsed = parseEdit(raw, index, ["path", "glob"]);
          const record = raw as Record<string, unknown>;
          if ("path" in record === "glob" in record)
            throw new Error(
              `edits[${index}] needs exactly one of path or glob.`,
            );
          const target = "path" in record ? record.path : record.glob;
          if (typeof target !== "string" || !target.trim())
            throw new Error(
              `edits[${index}].${"path" in record ? "path" : "glob"} must be a non-empty string.`,
            );
          return {
            parsed,
            target,
            files: [],
            ...("glob" in record ? { glob: target } : {}),
          };
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
            `edits[${edit.parsed.index}].glob ${JSON.stringify(edit.glob)} matches no files.`,
          );
        if (found.paths.length > SCRIPT_EDIT_MAX_FILES)
          throw new Error(
            `edits[${edit.parsed.index}].glob ${JSON.stringify(edit.glob)} matches more than ${SCRIPT_EDIT_MAX_FILES} files; narrow it.`,
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
    async run({ planned, dryRun }, env) {
      const outcome = await applyFileEdits(planned, {
        dryRun,
        notFoundHint: "Create it with files.write.",
      });
      for (const { file } of outcome.written)
        env.report.updated.push(`file ${file.shown}`);
      return await editResult(outcome, env, dryRun);
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
