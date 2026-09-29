import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  contained,
  noSymlinks,
  exists,
  atomicWrite,
  readManifest,
  hash,
  escapeHtml,
} from "./files.js";

export async function prepare(
  assetRoot: string,
  directory: string,
  options: { file?: string; title?: string; replaceAssets?: boolean },
) {
  const root = resolve(directory);
  const document = options.file ? resolve(root, options.file) : undefined;
  if (
    document &&
    (!contained(root, document) ||
      !/\.html$/i.test(document) ||
      document === root)
  )
    throw new Error(
      "--file must be an HTML path inside the destination directory.",
    );
  await noSymlinks(root);
  if (document) {
    await noSymlinks(document);
    if (await exists(document))
      throw new Error(`Refusing to overwrite authored HTML: ${document}`);
  }
  const destination = resolve(
    document ? dirname(document) : root,
    "richdoc-assets",
  );
  await noSymlinks(destination);
  const manifest = await readManifest(assetRoot);
  const pending: { path: string; data: Uint8Array }[] = [];
  const unchanged: string[] = [],
    conflicts: string[] = [];
  for (const name of [...Object.keys(manifest.files), "manifest.json"]) {
    const path = resolve(destination, name);
    if (!contained(destination, path))
      throw new Error("Invalid packaged asset path.");
    await noSymlinks(path);
    const data = await readFile(resolve(assetRoot, name));
    if (name !== "manifest.json" && hash(data) !== manifest.files[name].sha256)
      throw new Error(`Corrupt packaged asset: ${name}`);
    if (await exists(path)) {
      if (hash(await readFile(path)) === hash(data)) {
        unchanged.push(path);
        continue;
      }
      if (!options.replaceAssets) conflicts.push(path);
    }
    pending.push({ path, data });
  }
  if (conflicts.length)
    return {
      ok: false,
      code: "ASSET_CONFLICT",
      message:
        "Assets differ. Use --replace-assets explicitly; authored HTML is never replaced.",
      conflicts,
      created: [],
      unchanged,
    };
  const created: string[] = [];
  try {
    for (const item of pending) {
      await atomicWrite(item.path, item.data);
      created.push(item.path);
    }
    if (document) {
      await mkdir(dirname(document), { recursive: true });
      // Exclusive creation protects authored content against concurrent prepare calls.
      await writeFile(
        document,
        skeleton(options.title ?? "Untitled document"),
        { flag: "wx" },
      );
      created.push(document);
    }
  } catch (error) {
    return {
      ok: false,
      code: "PREPARE_PARTIAL",
      message: String(error),
      created,
      unchanged,
    };
  }
  return {
    ok: true,
    version: manifest.version,
    directory: root,
    document,
    created,
    unchanged,
    nextStep: "Author semantic HTML, then run validate on the HTML file.",
  };
}
export function skeleton(title: string) {
  const t = escapeHtml(title);
  return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${t}</title>\n  <link rel="stylesheet" href="./richdoc-assets/richdoc.css">\n  <script src="./richdoc-assets/richdoc.js" defer></script>\n</head>\n<body>\n<rd-page>\n  <header><h1>${t}</h1></header>\n  <rd-callout type="tldr"><p>Write a concise summary.</p></rd-callout>\n  <section><h2>Context</h2><p>Replace this with the document content.</p></section>\n</rd-page>\n</body>\n</html>\n`;
}
