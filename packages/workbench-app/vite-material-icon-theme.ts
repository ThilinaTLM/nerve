import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

const virtualId = "virtual:material-icon-theme";
const resolvedVirtualId = `\0${virtualId}`;
const developmentSpriteUrl = "/@nerve-material-file-icons.svg";

type MaterialIconManifest = {
  iconDefinitions: Record<string, { iconPath: string }>;
  file: string;
  folder: string;
  folderExpanded: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
};

function iconSymbol(svg: string, index: number): string {
  const opening = svg.match(/<svg\b([^>]*)>/i);
  const closingIndex = svg.toLocaleLowerCase().lastIndexOf("</svg>");
  if (!opening || opening.index === undefined || closingIndex < 0)
    throw new Error(`Material icon ${index} is not a valid SVG.`);
  const viewBox = opening[1]?.match(/viewBox="([^"]+)"/i)?.[1] ?? "0 0 16 16";
  let body = svg.slice(opening.index + opening[0].length, closingIndex);
  const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((entry) => entry[1]);
  for (const id of ids) {
    if (!id) continue;
    const scoped = `mit-${index}-${id}`;
    body = body.replaceAll(`id="${id}"`, `id="${scoped}"`);
    body = body.replaceAll(`#${id}`, `#${scoped}`);
  }
  return `<symbol id="mit-${index}" viewBox="${viewBox}">${body}</symbol>`;
}

export function materialIconThemePlugin(): Plugin {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("material-icon-theme/package.json");
  const packageDir = path.dirname(packageJson);
  const manifestPath = path.join(packageDir, "dist", "material-icons.json");
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as MaterialIconManifest;
  const referenced = new Set([
    manifest.file,
    manifest.folder,
    manifest.folderExpanded,
    ...Object.values(manifest.fileNames),
    ...Object.values(manifest.fileExtensions),
    ...Object.values(manifest.folderNames),
    ...Object.values(manifest.folderNamesExpanded),
  ]);
  const definitions = [...referenced]
    .filter((id) => manifest.iconDefinitions[id])
    .sort();
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>${definitions
    .map((definition, index) => {
      const iconPath = path.resolve(
        path.dirname(manifestPath),
        manifest.iconDefinitions[definition]!.iconPath,
      );
      return iconSymbol(readFileSync(iconPath, "utf8"), index);
    })
    .join("")}</defs></svg>`;
  let config!: ResolvedConfig;

  return {
    name: "nerve-material-icon-theme",
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(developmentSpriteUrl, (_request, response) => {
        response.setHeader("Content-Type", "image/svg+xml");
        response.setHeader("Cache-Control", "no-cache");
        response.end(sprite);
      });
    },
    resolveId(id) {
      return id === virtualId ? resolvedVirtualId : undefined;
    },
    load(id) {
      if (id !== resolvedVirtualId) return undefined;
      const spriteExpression =
        config.command === "build"
          ? `import.meta.ROLLUP_FILE_URL_${this.emitFile({
              type: "asset",
              name: "material-file-icons.svg",
              source: sprite,
            })}`
          : JSON.stringify(developmentSpriteUrl);
      const serialized = JSON.stringify({
        file: manifest.file,
        folder: manifest.folder,
        folderExpanded: manifest.folderExpanded,
        fileNames: manifest.fileNames,
        fileExtensions: manifest.fileExtensions,
        folderNames: manifest.folderNames,
        folderNamesExpanded: manifest.folderNamesExpanded,
      });
      return [
        `const spriteUrl = ${spriteExpression};`,
        `const definitions = ${JSON.stringify(definitions)};`,
        "const urls = Object.fromEntries(definitions.map((definition, index) => [definition, `#mit-${index}`]));",
        `export const materialIconThemeData = { ...${serialized}, spriteUrl, urls };`,
      ].join("\n");
    },
  };
}
