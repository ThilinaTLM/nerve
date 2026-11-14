import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ToolExecutionError } from "../../../execution/index.js";
import { executeEdit } from "../../../execution/index.js";
import { resolveToolPath } from "../../../execution/index.js";
import {
  ARTIFACT_PREFIX,
  artifactNameOf,
  listArtifacts,
  MAX_FILE_BYTES,
  notFound,
  parseHandle,
  readAuthorizations,
  readFileRef,
  reportArtifact,
  writeArtifact,
} from "./artifacts.js";
import { definePositionalMethod, type SdkMethod } from "../sdk-types.js";

/** `files.*` follows Node's positional style; it and `request()` are the documented exceptions to "one argument". */
export const filesMethods: SdkMethod[] = [
  definePositionalMethod({
    product: "files",
    path: "list",
    risk: "none",
    maxArgs: 0,
    signature: "list(): Promise<ArtifactInfo[]>",
    parse: () => undefined,
    resource: () => "artifacts",
    run: (_parsed, env) => listArtifacts(env),
  }),
  definePositionalMethod({
    product: "files",
    path: "read",
    risk: "read",
    maxArgs: 2,
    signature:
      '/** Default "text"; max 20 MB. */ read(handle: FileHandle, options: { as: "bytes" }): Promise<Uint8Array>; read(handle: FileHandle, options?: { as?: "text" }): Promise<string>',
    parse: ([handle, options]) => {
      const as = (options as { as?: unknown } | undefined)?.as ?? "text";
      if (as !== "text" && as !== "bytes") {
        throw new Error('as must be "text" or "bytes".');
      }
      return { handle, as };
    },
    // Resolved against the environment in `authorizeAlso` / `run`.
    authorizeAlso: ({ handle }, env) =>
      readAuthorizations([parseHandle(handle, env)]),
    resource: ({ handle }) => String(handle),
    async run({ handle, as }, env) {
      const bytes = await readFileRef(parseHandle(handle, env));
      // Bytes cross the JSON bridge as base64; the prelude decodes them to a Uint8Array.
      return as === "bytes"
        ? { encoding: "base64", data: bytes.toString("base64") }
        : bytes.toString("utf8");
    },
  }),
  definePositionalMethod({
    product: "files",
    path: "write",
    risk: "write",
    maxArgs: 3,
    signature:
      "/** `name` or an `artifact:name` handle writes an artifact; with workspace: true `name` is a workspace path. Returns the handle or path. */ write(name: string, data: string | Uint8Array | ArrayBuffer, options?: { workspace?: boolean }): Promise<string>",
    parse: ([name, data, options]) => {
      const workspace =
        (options as { workspace?: unknown } | undefined)?.workspace === true;
      const payload = data as { text?: unknown; base64?: unknown } | undefined;
      let bytes: Buffer;
      if (typeof payload?.text === "string")
        bytes = Buffer.from(payload.text, "utf8");
      else if (typeof payload?.base64 === "string")
        bytes = Buffer.from(payload.base64, "base64");
      else throw new Error("data must be a string, Uint8Array or ArrayBuffer.");
      if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error(
          `data is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}.`,
        );
      }
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name must be a non-empty string.");
      }
      if (workspace && name.startsWith(ARTIFACT_PREFIX)) {
        throw new Error(
          `${name} is an artifact handle; drop { workspace: true } or pass a workspace path.`,
        );
      }
      if (!workspace) {
        try {
          return { name: artifactNameOf(name), bytes, workspace };
        } catch (error) {
          throw /[\\/]/.test(name)
            ? new Error(
                `${(error as Error).message} For a workspace file use files.write(path, data, { workspace: true }).`,
              )
            : error;
        }
      }
      return { name, bytes, workspace };
    },
    // Artifacts are the tool's own files; only workspace writes are checked.
    authorize: ({ name, workspace }, env) => {
      if (!workspace) return undefined;
      const path = resolveToolPath(env.context.cwd, name);
      // Content is irrelevant to path policy and can be large; the schema only needs it present.
      return {
        toolName: "write",
        args: { path, content: "" },
        summary: path,
      };
    },
    resource: ({ name }) => name,
    async run({ name, bytes, workspace }, env) {
      if (!workspace) return await writeArtifact(env, name, bytes);
      const path = resolveToolPath(env.context.cwd, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      return path;
    },
  }),
  definePositionalMethod({
    product: "files",
    path: "edit",
    risk: "write",
    maxArgs: 2,
    signature:
      "/** Like the edit tool: each oldText must match exactly once in the original; all edits apply atomically. Returns the handle. */ edit(handle: FileHandle, edits: { oldText: string; newText: string }[]): Promise<FileHandle>",
    parse: ([handle, edits]) => {
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error(
          "edits must be a non-empty array of { oldText, newText }.",
        );
      }
      return { handle, edits: edits as { oldText: string; newText: string }[] };
    },
    // Artifacts are the tool's own files; workspace paths are checked as the direct `edit` tool.
    authorize: ({ handle, edits }, env) => {
      const ref = parseHandle(handle, env);
      return ref.kind === "workspace"
        ? {
            toolName: "edit",
            args: { path: ref.path, edits },
            summary: ref.path,
          }
        : undefined;
    },
    resource: ({ handle }) => String(handle),
    async run({ handle, edits }, env) {
      const ref = parseHandle(handle, env);
      const cwd = ref.kind === "artifact" ? dirname(ref.path) : env.context.cwd;
      try {
        await executeEdit(
          { path: ref.kind === "artifact" ? ref.name : ref.handle, edits },
          { cwd },
        );
      } catch (error) {
        if (!(error instanceof ToolExecutionError)) throw error;
        if (error.code === "EDIT_FILE_NOT_FOUND")
          throw ref.kind === "artifact"
            ? await notFound(ref)
            : new Error(`file not found: ${ref.handle}`);
        throw error;
      }
      if (ref.kind === "workspace") return ref.path;
      return reportArtifact(env, ref.name, (await stat(ref.path)).size);
    },
  }),
];
