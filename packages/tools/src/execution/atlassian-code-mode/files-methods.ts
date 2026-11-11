import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveToolPath } from "../filesystem/path.js";
import {
  assertArtifactName,
  listArtifacts,
  MAX_FILE_BYTES,
  parseHandle,
  readAuthorizations,
  readFileRef,
  writeArtifact,
} from "./artifacts.js";
import { definePositionalMethod, type SdkMethod } from "./sdk-types.js";

/** `files.*` follows Node's positional style; it and `request()` are the documented exceptions to "one argument". */
export const filesMethods: SdkMethod[] = [
  definePositionalMethod({
    product: "files",
    path: "list",
    maxArgs: 0,
    signature:
      "list(): Promise<{ handle, name, bytes, mediaType, modified }[]>  // this conversation's artifacts",
    parse: () => undefined,
    resource: () => "artifacts",
    run: (_parsed, env) => listArtifacts(env),
  }),
  definePositionalMethod({
    product: "files",
    path: "read",
    maxArgs: 2,
    signature:
      'read(handle, { as?: "text"|"bytes" }): Promise<string | Uint8Array>  // handle = "artifact:name" or a workspace path; max 20 MB',
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
    maxArgs: 3,
    signature:
      "write(name, data: string | Uint8Array | ArrayBuffer, { workspace?: boolean }): Promise<string>  // artifact by default (returns its handle); workspace: true writes the path as given",
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
      if (!workspace) assertArtifactName(name);
      return { name, bytes, workspace };
    },
    // Artifacts are the tool's own files; only workspace writes are checked.
    authorize: ({ name, workspace }, env) => {
      if (!workspace) return undefined;
      const path = resolveToolPath(env.context.cwd, name);
      return { toolName: "write", args: { path }, summary: path };
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
];
