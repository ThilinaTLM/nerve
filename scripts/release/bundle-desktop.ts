import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { build, type Metafile } from "esbuild";
import { externalRuntimeDependencies } from "./npm-manifests.ts";

/**
 * Pack-time bundling of the desktop distribution. Workspace development keeps
 * running unbundled tsc output; only the staged npm package is bundled.
 *
 * Everything is emitted into ONE flat `dist/` directory (entry points and
 * shared chunks alike). That is deliberate: code references siblings with
 * `new URL("./x.js", import.meta.url)` (worker threads, subprocess helpers,
 * the daemon) and package assets with `new URL("./builtin/", import.meta.url)`,
 * and a flat layout makes each of those resolve inside the staged `dist/`.
 */

/** Left external: runtime-provided or native packages (see npm-manifests.ts). */
const externalPackages = [...externalRuntimeDependencies, "@nervekit/native-*"];

/** Built workspace output (relative to the repository root) -> bundle entry name. */
export const bundleEntryPoints: Record<string, string> = {
  // Node launcher for `npx @nervekit/desktop`.
  bin: "packages/desktop-shell/dist/bin.js",
  // Electron main process (package.json `main`).
  main: "packages/desktop-shell/dist/main.js",
  // Daemon spawned by the main process (`resolveServerMain` in release mode).
  daemon: "packages/workbench-server/dist/main.js",
  // Worker/subprocess entrypoints, named as their referencing code expects.
  "html-to-markdown.worker":
    "packages/tools/dist/execution/web/html-to-markdown.worker.js",
  "git-isolated-reader-helper":
    "packages/tools/dist/git/read/git-isolated-reader-helper.js",
  worker:
    "packages/workbench-server/dist/infrastructure/migrations/framework/worker.js",
};

/** Runtime assets read relative to the bundled code: source (repo) -> stage path. */
export const bundleAssets: [source: string, destination: string][] = [
  ["packages/desktop-shell/dist/preload.cjs", "dist/preload.cjs"],
  ["packages/desktop-shell/build", "build"],
  ["packages/workbench-server/dist/web", "dist/web"],
  ["packages/workbench-server/dist/builtin-skills/builtin", "dist/builtin"],
  [
    "packages/tools/dist/quick-script/sandbox-libraries",
    "dist/sandbox-libraries",
  ],
  [
    "packages/tools/dist/quick-script/quick-script-docs",
    "dist/quick-script-docs",
  ],
  ["packages/extensions/dist/extension-docs", "dist/extension-docs"],
];

/** Files every bundled desktop dist must contain (relative to the package root). */
export const bundleOutputFiles = [
  ...Object.keys(bundleEntryPoints).map((name) => `dist/${name}.js`),
  "dist/preload.cjs",
  "dist/web/index.html",
  "dist/builtin/skill-creator/SKILL.md",
  "dist/sandbox-libraries/xlsx.full.min.js",
  "dist/sandbox-libraries/papaparse.min.js",
  "dist/sandbox-libraries/docx.min.js",
  "dist/sandbox-libraries/mammoth.browser.min.js",
  "dist/sandbox-libraries/pptxgen.bundle.js",
  "dist/sandbox-libraries/jszip.min.js",
  "dist/quick-script-docs/runtime/files.md",
  "dist/extension-docs/atlassian/docs/jira-workflows.md",
  "build/README.md",
  "THIRD-PARTY-LICENSES.txt",
];

// The ESM output must still satisfy CommonJS dependencies that call `require`
// for node builtins or optional modules.
const banner = `import { createRequire as __nerveCreateRequire } from "node:module";
const require = __nerveCreateRequire(import.meta.url);`;

export interface BundleResult {
  metafile: Metafile;
}

export async function bundleDesktop(options: {
  repoRoot: string;
  stageRoot: string;
}): Promise<BundleResult> {
  const { repoRoot, stageRoot } = options;
  const entryPoints = Object.fromEntries(
    Object.entries(bundleEntryPoints).map(([name, path]) => [
      name,
      join(repoRoot, path),
    ]),
  );
  const result = await build({
    entryPoints,
    outdir: join(stageRoot, "dist"),
    entryNames: "[name]",
    chunkNames: "chunk-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: externalPackages,
    banner: { js: banner },
    legalComments: "linked",
    metafile: true,
    sourcemap: false,
    logLevel: "warning",
  });

  for (const [source, destination] of bundleAssets) {
    const target = join(stageRoot, destination);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repoRoot, source), target, { recursive: true });
  }

  await writeFile(
    join(stageRoot, "THIRD-PARTY-LICENSES.txt"),
    await collectThirdPartyLicenses(repoRoot, result.metafile),
  );
  return { metafile: result.metafile };
}

/** `node_modules/<pkg>` roots (pnpm-resolved) of all third-party inputs in the bundle. */
export function thirdPartyPackageRoots(metafile: Metafile): string[] {
  const roots = new Set<string>();
  const marker = "node_modules/";
  for (const input of Object.keys(metafile.inputs)) {
    const normalized = input.replaceAll("\\", "/");
    const index = normalized.lastIndexOf(marker);
    if (index < 0) continue;
    const parts = normalized.slice(index + marker.length).split("/");
    const name = parts.slice(0, parts[0]?.startsWith("@") ? 2 : 1).join("/");
    if (!name || name.startsWith("@nervekit/")) continue;
    roots.add(`${normalized.slice(0, index + marker.length)}${name}`);
  }
  return [...roots].sort();
}

/** Packages shipped as copied assets (not esbuild inputs) that still need license text. */
const assetShippedPackageRoots = [
  "packages/tools/node_modules/docx",
  "packages/tools/node_modules/jszip",
  "packages/tools/node_modules/mammoth",
  "packages/tools/node_modules/papaparse",
  "packages/tools/node_modules/pptxgenjs",
  "packages/tools/node_modules/xlsx",
];

async function collectThirdPartyLicenses(
  repoRoot: string,
  metafile: Metafile,
): Promise<string> {
  const sections: string[] = [
    "Third-party software bundled into @nervekit/desktop.\n",
  ];
  const seen = new Set<string>();
  const roots = [
    ...thirdPartyPackageRoots(metafile),
    ...assetShippedPackageRoots,
  ];
  for (const root of roots) {
    const directory = await realpath(join(repoRoot, root));
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { name?: string; version?: string; license?: unknown };
    const id = `${manifest.name}@${manifest.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const licenseFile = (await readdir(directory)).find((name) =>
      /^(licen[sc]e|copying|notice)(\.|$)/i.test(name),
    );
    const text = licenseFile
      ? (await readFile(join(directory, licenseFile), "utf8")).trim()
      : `(no license file shipped; declared license: ${JSON.stringify(manifest.license ?? "unknown")})`;
    sections.push(`${"=".repeat(72)}\n${id}\n${"=".repeat(72)}\n${text}\n`);
  }
  return sections.join("\n");
}
