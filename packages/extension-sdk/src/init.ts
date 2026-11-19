import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { extensionIdSchema } from "@nervekit/contracts/extensions";
import { sdkVersion } from "./build.js";
import { ExtensionProjectError } from "./problems.js";
import { projectTemplate } from "./templates.js";

export const extensionKinds = [
  "preview",
  "page",
  "panel",
  "theme",
  "integration",
] as const;
export type ExtensionKind = (typeof extensionKinds)[number];

export type InitOptions = {
  id: string;
  /** One kind or several (`integration` and `panel`): their parts combine into one project. */
  kind: ExtensionKind | readonly ExtensionKind[];
  /** Where to write the project; default `./<id>` under `cwd`. The folder name must equal the id. */
  dir?: string;
  cwd?: string;
  /** The version to pin; default: this SDK's. */
  sdkVersion?: string;
};

/** Writes a new extension project and returns its folder. */
export async function initExtension(options: InitOptions): Promise<string> {
  if (!extensionIdSchema.safeParse(options.id).success)
    throw new ExtensionProjectError({
      what: `'${options.id}' is not a valid extension id.`,
      where: "nerve-ext init <id>",
      fix: "Use lowercase letters, digits and single hyphens, starting with a letter, at most 64 characters (for example `csv-viewer`).",
    });
  const kinds = [
    ...new Set(
      typeof options.kind === "string" ? [options.kind] : options.kind,
    ),
  ];
  const unknown = kinds.filter((kind) => !extensionKinds.includes(kind));
  if (kinds.length === 0 || unknown.length > 0)
    throw new ExtensionProjectError({
      what: `'${unknown.join(",")}' is not an extension kind.`,
      where: "nerve-ext init --kind",
      fix: `Use one or more of: ${extensionKinds.join(", ")} (comma-separated).`,
    });
  const folder = resolve(
    options.cwd ?? process.cwd(),
    options.dir ?? options.id,
  );
  if (!folder.endsWith(`/${options.id}`) && !folder.endsWith(`\\${options.id}`))
    throw new ExtensionProjectError({
      what: `The folder name must equal the extension id '${options.id}'.`,
      where: folder,
      fix: `Pass --dir with a path ending in '${options.id}', or omit --dir.`,
    });
  const existing = await readdir(folder).catch(() => undefined);
  if (existing && existing.length > 0)
    throw new ExtensionProjectError({
      what: `The folder is not empty.`,
      where: folder,
      fix: "Choose another --dir, or remove the folder first.",
    });
  const files = projectTemplate(
    options.id,
    kinds,
    options.sdkVersion ?? (await sdkVersion()),
  );
  for (const [path, content] of Object.entries(files)) {
    const target = join(folder, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return folder;
}
