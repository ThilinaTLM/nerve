import { stat } from "node:fs/promises";
import { join } from "node:path";
import { artifactNameOf } from "@nervekit/extension-api/host";
import { defineMethod } from "../sdk-args.js";
import type { SdkEnvironment, SdkMethod } from "../sdk-types.js";
import {
  artifactDir,
  listArtifacts,
  notFound,
  readFileRef,
  reportArtifact,
  writeArtifact,
} from "./artifacts.js";
import { editResult } from "./edit-result.js";
import { applyFileEdits } from "./file-edits.js";
import { payloadBytes } from "./files-methods.js";
import { parseEdit } from "./text-edits.js";

/** `artifacts.*`: the conversation's own files; no permission check. */

/** `name` or `artifact:name`; a path gets a pointer to `files.*`. */
function nameOf(value: unknown): string {
  try {
    return artifactNameOf(value);
  } catch (error) {
    throw typeof value === "string" && /[\\/]/.test(value)
      ? new Error(
          `${(error as Error).message} For a workspace file use files.* instead.`,
        )
      : error;
  }
}

function artifactRef(name: string, env: SdkEnvironment) {
  return {
    kind: "artifact" as const,
    name,
    path: join(artifactDir(env), name),
    handle: `artifact:${name}`,
  };
}

export const artifactsMethods: SdkMethod[] = [
  defineMethod({
    product: "artifacts",
    path: "list",
    risk: "none",
    options: [],
    signature: "list(): Promise<ArtifactInfo[]>",
    parse: () => undefined,
    resource: () => "artifacts",
    run: (_parsed, env) => listArtifacts(env),
  }),
  defineMethod({
    product: "artifacts",
    path: "read",
    risk: "none",
    bare: "name",
    options: ["name", "as"],
    signature:
      '/** `name` or an `artifact:` handle; text (default) or bytes; max 20 MB. */ read(name: string | { name: string; as?: "text" }): Promise<string>; read(options: { name: string; as: "bytes" }): Promise<Uint8Array>',
    parse: (options) => {
      const as = options.as ?? "text";
      if (as !== "text" && as !== "bytes")
        throw new Error('as must be "text" or "bytes".');
      return { name: nameOf(options.name), as };
    },
    resource: ({ name }) => `artifact:${name}`,
    async run({ name, as }, env) {
      const bytes = await readFileRef(artifactRef(name, env));
      // Bytes cross the JSON bridge as base64; the prelude decodes them to a Uint8Array.
      return as === "bytes"
        ? { encoding: "base64", data: bytes.toString("base64") }
        : bytes.toString("utf8");
    },
  }),
  defineMethod({
    product: "artifacts",
    path: "write",
    risk: "none",
    options: ["name", "data"],
    signature:
      "/** Creates or overwrites an artifact; `name` or an `artifact:` handle; max 20 MB. Returns the handle. */ write(options: { name: string; data: string | Uint8Array | ArrayBuffer }): Promise<FileHandle>",
    parse: (options) => ({
      name: nameOf(options.name),
      bytes: payloadBytes(options.data),
    }),
    resource: ({ name }) => `artifact:${name}`,
    run: ({ name, bytes }, env) => writeArtifact(env, name, bytes),
  }),
  defineMethod({
    product: "artifacts",
    path: "edit",
    risk: "none",
    options: ["name", "edits", "dryRun"],
    signature:
      "/** Edits an artifact like files.edit (edits apply in list order; all or nothing). Returns the result with its diff. */ edit(options: { name: string; edits: TextEdit[]; dryRun?: boolean }): Promise<EditResult>",
    parse: (options) => {
      const { edits, dryRun } = options;
      if (!Array.isArray(edits) || edits.length === 0)
        throw new Error("edits must be a non-empty array.");
      if (dryRun !== undefined && typeof dryRun !== "boolean")
        throw new Error("dryRun must be a boolean.");
      return {
        name: nameOf(options.name),
        dryRun: dryRun === true,
        parsed: edits.map((raw, index) => parseEdit(raw, index, [])),
      };
    },
    resource: ({ name }) => `artifact:${name}`,
    async run({ name, dryRun, parsed }, env) {
      const ref = artifactRef(name, env);
      const exists = await stat(ref.path).then(
        () => true,
        () => false,
      );
      if (!exists) throw await notFound(ref);
      const file = { path: ref.path, shown: ref.handle };
      const outcome = await applyFileEdits(
        parsed.map((edit) => ({ parsed: edit, files: [file] })),
        { dryRun, notFoundHint: "artifacts.list() shows the existing ones." },
      );
      for (const { bytes } of outcome.written) reportArtifact(env, name, bytes);
      return await editResult(outcome, env, dryRun);
    },
  }),
];
