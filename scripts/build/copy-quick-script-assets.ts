import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
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

const packageRoot = join(repoRoot, "packages", "quick-script");
const destination = join(packageRoot, "dist", "sandbox-libraries");

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

// quick_script doc topics (Markdown beside the code that owns them) -> dist/quick-script-docs/<owner>/.
const srcRoot = join(packageRoot, "src");
const docsDestination = join(packageRoot, "dist", "quick-script-docs");
await rm(docsDestination, { recursive: true, force: true });
await cp(join(srcRoot, "runtime", "docs"), join(docsDestination, "runtime"), {
  recursive: true,
});
for (const owner of await readdir(join(srcRoot, "extensions"), {
  withFileTypes: true,
})) {
  const docs = join(srcRoot, "extensions", owner.name, "docs");
  if (owner.isDirectory() && existsSync(docs))
    await cp(docs, join(docsDestination, owner.name), { recursive: true });
}
