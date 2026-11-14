import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { repoRoot } from "../workspace/repo.ts";

/**
 * Sandbox library files (and licenses) shipped as assets: package -> file.
 * `minify` entries are shipped unminified by their package and get one esbuild pass.
 */
const libraries = [
  { name: "xlsx", file: "dist/xlsx.full.min.js" },
  { name: "papaparse", file: "papaparse.min.js" },
  {
    name: "docx",
    file: "dist/index.iife.js",
    out: "docx.min.js",
    minify: true,
  },
  { name: "mammoth", file: "mammoth.browser.min.js" },
  // The bundle build includes JSZip (the min build does not); it defines both globals.
  { name: "pptxgenjs", file: "dist/pptxgen.bundle.js" },
  { name: "jszip", file: "dist/jszip.min.js", license: "LICENSE.markdown" },
];

const packageRoot = join(repoRoot, "packages", "tools");
// Under dist/quick-script/ so `./sandbox-libraries/` resolves from the module that reads it.
const destination = join(
  packageRoot,
  "dist",
  "quick-script",
  "sandbox-libraries",
);

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const { name, file, ...options } of libraries) {
  const source = join(packageRoot, "node_modules", name);
  const out = join(destination, options.out ?? file.split("/").pop()!);
  if (options.minify) {
    await build({
      entryPoints: [join(source, file)],
      outfile: out,
      minify: true,
      target: "es2020",
      legalComments: "none",
      logLevel: "warning",
    });
  } else {
    await cp(join(source, file), out);
  }
  await cp(
    join(source, options.license ?? "LICENSE"),
    join(destination, `${name}.LICENSE`),
  );
}

// Runtime doc topics (Markdown beside the code that owns them) -> dist/quick-script/quick-script-docs/runtime/.
// Extensions ship their own topics (scripts/build/copy-extension-assets.ts).
const docsDestination = join(
  packageRoot,
  "dist",
  "quick-script",
  "quick-script-docs",
);
await rm(docsDestination, { recursive: true, force: true });
await cp(
  join(packageRoot, "src", "quick-script", "runtime", "docs"),
  join(docsDestination, "runtime"),
  { recursive: true },
);
