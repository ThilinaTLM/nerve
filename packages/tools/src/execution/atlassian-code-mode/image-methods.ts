import { extname } from "node:path";
import { image } from "@nervekit/native";
import {
  parseHandle,
  readAuthorizations,
  readFileRef,
  writeArtifact,
} from "./artifacts.js";
import { defineMethod, type SdkMethod } from "./sdk-types.js";

type Ops = Parameters<typeof image.transformImage>[1];

/** `image(handle)` is a chain built in the sandbox prelude; these two host methods do the work natively. */
function parseImage(options: Record<string, unknown>) {
  const ops = (options.ops ?? {}) as Ops;
  if (typeof ops !== "object" || Array.isArray(ops)) {
    throw new Error("ops must be an object.");
  }
  return { file: options.file, ops, name: options.name };
}

async function transform(
  env: Parameters<SdkMethod["prepare"]>[1],
  file: unknown,
  ops: Ops,
) {
  return await image.transformImage(
    await readFileRef(parseHandle(file, env)),
    ops,
  );
}

export const imageMethods: SdkMethod[] = [
  defineMethod({
    product: "image",
    path: "info",
    options: ["file", "ops"],
    signature: "info(): Promise<ImageInfo>",
    parse: parseImage,
    authorizeAlso: ({ file }, env) =>
      readAuthorizations([parseHandle(file, env)]),
    resource: ({ file }) => String(file),
    async run({ file, ops }, env) {
      if (Object.keys(ops).length === 0) {
        const bytes = await readFileRef(parseHandle(file, env));
        const info = await image.imageInfo(bytes);
        return { ...info, bytes: bytes.byteLength };
      }
      const out = await transform(env, file, ops);
      return {
        format: out.format,
        width: out.width,
        height: out.height,
        bytes: out.data.byteLength,
      };
    },
  }),
  defineMethod({
    product: "image",
    path: "save",
    options: ["file", "ops", "name"],
    signature: "save(name: string): Promise<FileHandle>",
    parse: parseImage,
    authorizeAlso: ({ file }, env) =>
      readAuthorizations([parseHandle(file, env)]),
    resource: ({ file }) => String(file),
    async run({ file, ops, name }, env) {
      if (typeof name !== "string" || !name) {
        throw new Error(
          "save(name) needs an artifact name such as 'chart.png'.",
        );
      }
      const out = await transform(env, file, ops);
      const fileName = extname(name)
        ? name
        : `${name}.${out.format === "jpeg" ? "jpg" : "png"}`;
      return await writeArtifact(env, fileName, out.data);
    },
  }),
];
