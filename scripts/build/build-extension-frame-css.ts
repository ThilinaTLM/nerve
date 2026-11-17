import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

/*
 * Builds `packages/workbench-server/dist/ext-frame/`: the base stylesheet every extension frame
 * loads (`/ext-frame/base.css`) and the fonts it references (`/ext-frame/assets/`). It is the
 * ui-kit's theme structure, base layer, animations and component CSS compiled with the Tailwind
 * preset, without the values of any theme: those arrive with the frame's `init` message. The
 * per-theme blocks of `theme.css` are cut out here, so an extension frame cannot depend on a
 * built-in theme being present.
 */

const uiKit = join(repoRoot, "packages", "ui-kit");
const outDir = join(
  repoRoot,
  "packages",
  "workbench-server",
  "dist",
  "ext-frame",
);
const work = join(uiKit, "node_modules", ".cache", "ext-frame-css");

/** `theme.css` without the `:root[data-theme=…]` blocks (from the first theme block to the control-height `@theme`). */
export function withoutThemeBlocks(css: string): string {
  const start = css.indexOf("/* Nerve Light:");
  const end = css.indexOf("/* Control heights.");
  if (start < 0 || end < start)
    throw new Error(
      "theme.css no longer has the expected structure: update withoutThemeBlocks in scripts/build/build-extension-frame-css.ts",
    );
  return css.slice(0, start) + css.slice(end);
}

export async function buildExtensionFrameCss(): Promise<void> {
  // Vite and the Tailwind plugin are ui-kit devDependencies.
  const require = createRequire(join(uiKit, "package.json"));
  const { build } = (await import(require.resolve("vite"))) as {
    build(config: Record<string, unknown>): Promise<unknown>;
  };
  const tailwindcss = (
    (await import(require.resolve("@tailwindcss/vite"))) as {
      default: () => unknown;
    }
  ).default;

  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const styles = join(uiKit, "src", "styles");
  await writeFile(
    join(work, "theme.css"),
    withoutThemeBlocks(await readFile(join(styles, "theme.css"), "utf8")),
  );
  const font = (weight: number) => `@font-face {
  font-family: "Iosevka";
  font-style: normal;
  font-display: swap;
  font-weight: ${weight};
  src: url("${join(uiKit, "node_modules", "@fontsource", "iosevka", "files", `iosevka-latin-${weight}-normal.woff2`)}") format("woff2");
}`;
  const entry = (
    await readFile(
      join(repoRoot, "scripts", "build", "extension-frame.css"),
      "utf8",
    )
  )
    .replaceAll("__STYLES__", styles)
    .replace("/* __IOSEVKA__ */", `${font(400)}\n${font(500)}`);
  await writeFile(join(work, "frame.css"), entry);
  // The bundler needs a script entry to pull the stylesheet in.
  await writeFile(
    join(work, "entry.js"),
    ["import", JSON.stringify("./frame.css")].join(" ") + ";\n",
  );

  await rm(outDir, { recursive: true, force: true });
  await build({
    root: work,
    configFile: false,
    logLevel: "warn",
    base: "./",
    plugins: [tailwindcss()],
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      minify: true,
      rollupOptions: {
        input: join(work, "entry.js"),
        output: {
          entryFileNames: "entry.js",
          assetFileNames: (info: { names?: string[] }) =>
            info.names?.some((name: string) => name.endsWith(".css"))
              ? "base.css"
              : "assets/[name]-[hash][extname]",
        },
      },
    },
  });
  // The entry only existed to pull the stylesheet in.
  await rm(join(outDir, "entry.js"), { force: true });
  const files = await readdir(outDir);
  if (!files.includes("base.css"))
    throw new Error(
      `The frame stylesheet was not produced (found ${files.join(", ")}).`,
    );
  await rm(work, { recursive: true, force: true });
  console.log(`Built extension frame CSS in ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  await buildExtensionFrameCss();
