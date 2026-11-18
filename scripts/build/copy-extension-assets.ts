import { existsSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { repoRoot } from "../workspace/repo.ts";

// Files the host reads for each built-in extension (beside the code that owns them): quick_script
// doc topics (`docs/<file>`) and the icon (`icon.svg`)
// -> packages/extensions/dist/extension-assets/<owner>/ (the declared paths are relative to it).
// An extension with a `bundle.ts` also gets `bundle.js`: its code as one classic script (IIFE)
// for the sandbox. `@nervekit/extension-api` is not bundled; the sandbox runtime library
// provides it (`globalThis.__nerveExtensionApi`), so extension and runtime share one `ExtensionError`.
const packageRoot = join(repoRoot, "packages", "extensions");
const srcRoot = join(packageRoot, "src");
const destination = join(packageRoot, "dist", "extension-assets");

await rm(destination, { recursive: true, force: true });
for (const owner of await readdir(srcRoot, { withFileTypes: true })) {
  if (!owner.isDirectory()) continue;
  const docs = join(srcRoot, owner.name, "docs");
  if (existsSync(docs))
    await cp(docs, join(destination, owner.name, "docs"), { recursive: true });
  const entry = join(srcRoot, owner.name, "bundle.ts");
  if (existsSync(entry))
    await build({
      entryPoints: [entry],
      outfile: join(destination, owner.name, "bundle.js"),
      bundle: true,
      format: "iife",
      target: "es2020",
      legalComments: "none",
      logLevel: "warning",
      plugins: [
        {
          name: "extension-api-from-runtime",
          setup(builder) {
            builder.onResolve({ filter: /^@nervekit\/extension-api$/ }, () => ({
              path: "extension-api",
              namespace: "nerve-runtime",
            }));
            builder.onLoad(
              { filter: /.*/, namespace: "nerve-runtime" },
              () => ({
                contents: "module.exports = globalThis.__nerveExtensionApi;",
                loader: "js",
              }),
            );
          },
        },
      ],
    });
  const icon = join(srcRoot, owner.name, "icon.svg");
  if (existsSync(icon))
    await cp(icon, join(destination, owner.name, "icon.svg"));
}
