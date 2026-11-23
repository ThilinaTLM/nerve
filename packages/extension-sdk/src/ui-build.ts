import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultPreviewEdit,
  extensionFileLimits,
  themeFileSchema,
  themeRuleProblems,
  themeFilePath,
  uiEntryPath,
  type InstalledExtensionManifest,
} from "@nervekit/contracts/extensions";
import type { ExtensionUi } from "@nervekit/extension-api";
import { ExtensionProjectError, type Problem } from "./problems.js";

type UiManifest = NonNullable<InstalledExtensionManifest["ui"]>;

const require = createRequire(import.meta.url);
const sdkRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const contributionKeys = {
  previews: ["id", "label", "match", "entry", "edit"],
  pages: ["id", "label", "icon", "entry", "newMenu"],
  panels: ["id", "label", "icon", "entry"],
  themes: ["id", "label", "file"],
} as const;
type Kind = keyof typeof contributionKeys;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function inside(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split(/[\\/]/).includes("..")
  );
}

export type UiPlan = {
  /** The `ui` section of `manifest.json`. */
  manifest: UiManifest;
  /** Frames to build: contribution id and the absolute source entry. */
  frames: { id: string; kind: "preview" | "page" | "panel"; entry: string }[];
  /** Theme files to copy: source and `dist/`-relative target. */
  themes: { source: string; target: string }[];
};

/**
 * Turns the definition's `ui` (source paths) into the manifest's `ui` (output paths): resolves
 * each preview's `edit`, reads each theme file for its `kind` and checks every source exists.
 * Unknown fields, missing files and invalid theme files are problems; nothing is built yet.
 */
export async function planUi(
  projectDir: string,
  ui: ExtensionUi | undefined,
): Promise<UiPlan | undefined> {
  if (ui === undefined) return undefined;
  const problems: Problem[] = [];
  const plan: UiPlan = { manifest: {}, frames: [], themes: [] };
  const where = (kind: Kind, index: number, field?: string) =>
    `src/extension.ts: ui.${kind}[${index}]${field ? `.${field}` : ""}`;

  for (const key of Object.keys(ui))
    if (!Object.hasOwn(contributionKeys, key))
      problems.push({
        what: `Unknown field ui.${key} in the extension definition.`,
        where: "src/extension.ts: ui",
        fix: "Use ui.previews, ui.pages, ui.panels and ui.themes.",
      });

  for (const kind of Object.keys(contributionKeys) as Kind[]) {
    const list = (ui as Record<string, readonly unknown[] | undefined>)[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push({
        what: `ui.${kind} must be an array.`,
        where: `src/extension.ts: ui.${kind}`,
        fix: `Write ui.${kind}: [{ ... }].`,
      });
      continue;
    }
    const manifestList: Record<string, unknown>[] = [];
    for (const [index, raw] of list.entries()) {
      const item = raw as Record<string, unknown>;
      for (const key of Object.keys(item))
        if (!(contributionKeys[kind] as readonly string[]).includes(key))
          problems.push({
            what: `Unknown field ${key} in ui.${kind}[${index}].`,
            where: where(kind, index, key),
            fix: `Allowed fields: ${contributionKeys[kind].join(", ")}.`,
          });
      const id = String(item["id"]);
      const sourceField = kind === "themes" ? "file" : "entry";
      const source = item[sourceField];
      const sourceOk = typeof source === "string" && inside(source);
      if (!sourceOk)
        problems.push({
          what: `ui.${kind}[${index}].${sourceField} must be a path inside the extension folder.`,
          where: where(kind, index, sourceField),
          fix:
            kind === "themes"
              ? 'Point it at the theme file, for example "src/themes/solarized-dark.json".'
              : 'Point it at the component, for example "src/previews/table/Table.svelte".',
        });
      else if (!(await exists(join(projectDir, source))))
        problems.push({
          what: `${source} does not exist.`,
          where: where(kind, index, sourceField),
          fix: `Create ${source}, or correct the path in the definition.`,
        });
      else if (kind !== "themes" && !/\.(svelte|ts|tsx)$/.test(source))
        problems.push({
          what: `The ${sourceField} '${source}' must be a .svelte component, a .ts module or a .tsx module.`,
          where: where(kind, index, sourceField),
          fix: "Write the UI as a Svelte component (src/<kind>/<name>/<Name>.svelte), or as a .ts/.tsx module whose default export mounts into an element and returns its cleanup (a .tsx entry needs `npm install --ignore-scripts react react-dom`).",
        });

      if (kind === "themes") {
        const entry: Record<string, unknown> = {
          id,
          label: item["label"],
          kind: "dark",
          file: themeFilePath(id),
        };
        if (sourceOk && (await exists(join(projectDir, source)))) {
          const file = await readThemeFile(projectDir, source, id, problems);
          if (file) {
            entry["kind"] = file.kind;
            plan.themes.push({
              source: join(projectDir, source),
              target: themeFilePath(id),
            });
          }
        }
        manifestList.push(entry);
        continue;
      }
      const frameKind =
        kind === "previews" ? "preview" : kind === "pages" ? "page" : "panel";
      if (sourceOk)
        plan.frames.push({
          id,
          kind: frameKind,
          entry: join(projectDir, source as string),
        });
      if (kind === "previews") {
        const extensions =
          (item["match"] as { extensions?: string[] } | undefined)
            ?.extensions ?? [];
        manifestList.push({
          id,
          label: item["label"],
          match: item["match"],
          edit: item["edit"] ?? defaultPreviewEdit(extensions),
          entry: uiEntryPath(id),
        });
      } else
        manifestList.push({
          id,
          label: item["label"],
          icon: item["icon"],
          ...(kind === "pages" ? { newMenu: item["newMenu"] ?? true } : {}),
          entry: uiEntryPath(id),
        });
    }
    (plan.manifest as Record<string, unknown>)[kind] = manifestList;
  }
  if (problems.length > 0) throw new ExtensionProjectError(problems);
  return plan;
}

async function readThemeFile(
  projectDir: string,
  source: string,
  id: string,
  problems: Problem[],
) {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(projectDir, source), "utf8"));
  } catch (cause) {
    problems.push({
      what: `${source} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      where: join(projectDir, source),
      fix: "Write the theme as JSON: { id, label, kind, tokens } with all 17 tokens (nerve-ext init --kind theme shows one).",
    });
    return undefined;
  }
  const parsed = themeFileSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      problems.push({
        what: `Invalid theme file ${source} at ${issue.path.join(".") || "(file)"}: ${issue.message}`,
        where: join(projectDir, source),
        fix: 'A theme file holds { id, label, kind: "light"|"dark", tokens } with exactly the 17 colour tokens, each a hex colour or an rgb/hsl/oklch function with plain numbers.',
      });
    return undefined;
  }
  if (parsed.data.id !== id)
    problems.push({
      what: `${source} has id '${parsed.data.id}' but the theme contribution is '${id}'.`,
      where: join(projectDir, source),
      fix: `Set "id": "${id}" in the theme file, or change the contribution id.`,
    });
  // The readability bar Nerve holds its built-in themes to; the host refuses a theme that fails it.
  for (const rule of themeRuleProblems(parsed.data.kind, parsed.data.tokens))
    problems.push({
      what: `Theme ${source} is not readable enough: ${rule}`,
      where: join(projectDir, source),
      fix: "Adjust the colour so text meets the 4.5:1 contrast on the background and the syntax colours stay distinct; compare the built-in themes' values.",
    });
  return parsed.data;
}

// ── Frame compatibility ───────────────────────────────────────────────────

const frameForbidden: {
  pattern: RegExp;
  name: string;
  fix: string;
}[] = [
  {
    pattern: /^@nervekit\/extension-api(\/|$)/,
    name: "direct API import",
    fix: "Extensions import only from '@nervekit/extension-sdk'. Change the import to '@nervekit/extension-sdk' (types and helpers) or '@nervekit/extension-sdk/ui' (frame code).",
  },
  {
    pattern:
      /^@nervekit\/ui-kit\/components\/(ui\/(alert-dialog|dialog)|composites\/(confirm-dialog|dialog-shell|form-dialog))(\/|$)/,
    name: "dialog",
    fix: "A frame cannot draw dialogs outside its rectangle. Ask with `await host.ui.confirm({ title, message })`, or render the form inline in the page.",
  },
  {
    pattern: /^@nervekit\/ui-kit\/components\/ui\/sheet(\/|$)/,
    name: "sheet",
    fix: "A frame cannot draw outside its rectangle. Render the content in the layout (a resizable pane or a collapsible section) instead of a sheet.",
  },
  {
    pattern:
      /^@nervekit\/ui-kit\/components\/(ui\/(context-menu|dropdown-menu)|composites\/context-menu-list)(\/|$)/,
    name: "menu",
    fix: "A frame cannot draw menus outside its rectangle. In a click handler call `await host.ui.menu([{ id, label }], { anchor: button })`; the host draws the menu (separators, icons, checks, submenus) and returns the chosen id. Rows and trees take `menuItems`.",
  },
  {
    pattern:
      /^@nervekit\/ui-kit\/components\/(ui\/select|composites\/select-field)(\/|$)/,
    name: "select",
    fix: "A frame cannot draw a select list outside its rectangle. Use `SelectField` from '@nervekit/extension-sdk/ui' (the host draws the list), or call `await host.ui.pick({ mode: 'single', ariaLabel, items, anchor })` from a click handler.",
  },
  {
    pattern: /^(@nervekit\/ui-kit\/components\/ui\/sonner|svelte-sonner)(\/|$)/,
    name: "toast",
    fix: "A frame has no toaster. Call `host.ui.notify(message, level)`; the host shows the toast.",
  },
];

function isInside(root: string, path: string | undefined): boolean {
  if (!path) return false;
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

/** Whether `file` belongs to the extension's own sources (not a dependency, the UI kit or the SDK). */
function isUserFile(file: string | undefined, projectDir: string): boolean {
  if (!file || file.startsWith("\0")) return false;
  const path = file.split("?")[0]!;
  const rel = relative(projectDir, path);
  return (
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel) &&
    !rel.split(sep).includes("node_modules")
  );
}

// ── Vite build ────────────────────────────────────────────────────────────

/** `@theme` blocks of the UI kit's `theme.css`: the utilities' mapping to variables, without token values. */
export function extractThemeBlocks(css: string): string {
  const blocks: string[] = [];
  const header = /^@theme(?: inline)? \{/gm;
  let match: RegExpExecArray | null;
  while ((match = header.exec(css))) {
    let depth = 0;
    let end = match.index;
    for (let at = match.index + match[0].length - 1; at < css.length; at += 1) {
      if (css[at] === "{") depth += 1;
      else if (css[at] === "}" && --depth === 0) {
        end = at + 1;
        break;
      }
    }
    blocks.push(css.slice(match.index, end));
    header.lastIndex = end;
  }
  return blocks.join("\n\n");
}

function frameEntryModule(entry: string): string {
  // Vite resolves `/`-separated absolute ids on every OS (`C:/…` on Windows).
  const importPath = JSON.stringify(entry.split(sep).join("/"));
  return `import { mount, unmount } from "svelte";
import { startFrame } from "@nervekit/extension-sdk/ui";
import * as entry from ${importPath};

const target = document.getElementById("app");
if (!target) throw new Error("The frame page has no #app element.");
void startFrame({
  target,
  render(element, init) {
    const component = (entry as { default?: unknown }).default;
    if (${JSON.stringify(entry.endsWith(".svelte"))}) {
      const instance = mount(component as never, { target: element });
      return () => void unmount(instance);
    }
    if (typeof component === "function") return (component as (target: HTMLElement, init: unknown) => void | (() => void))(element, init);
  },
});
`;
}

const frameHtml = (work: string) =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Extension</title>
    <link rel="stylesheet" href="__WORK__/frame.css" />
    <script type="module" src="__WORK__/main.ts"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`.replaceAll("__WORK__", work);

/** Builds every planned frame into `distDir/ui/<id>/`. */
export async function buildFrames(
  projectDir: string,
  distDir: string,
  frames: UiPlan["frames"],
): Promise<void> {
  if (frames.length === 0) return;
  const [{ build }, { svelte, vitePreprocess }, tailwind] = await Promise.all([
    import("vite"),
    import("@sveltejs/vite-plugin-svelte"),
    import("@tailwindcss/vite"),
  ]);
  const kitStyles = (name: string) =>
    require.resolve(`@nervekit/ui-kit/styles/${name}`);
  const kitLib = join(dirname(kitStyles("theme.css")), "..", "lib");
  const themeBlocks = extractThemeBlocks(
    await readFile(kitStyles("theme.css"), "utf8"),
  );
  const workRoot = join(projectDir, ".nerve-ext");
  const anchor = join(sdkRoot, "package.json");
  const forbidden: Problem[] = [];

  const resolvePlugin = (): import("vite").Plugin => ({
    name: "nerve-frame-resolve",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (isUserFile(importer, projectDir) || isInside(workRoot, importer)) {
        for (const rule of frameForbidden)
          if (rule.pattern.test(source)) {
            forbidden.push({
              what: `'${source}' (${rule.name}) cannot work inside an extension frame.`,
              where: importer ?? "src/ui",
              fix: rule.fix,
            });
            return "\0nerve-frame-forbidden";
          }
      }
      if (source === "\0nerve-frame-forbidden") return source;
      // One copy of Svelte, the UI kit and the bridge client per frame, whatever the project's layout.
      if (/^(svelte|@nervekit\/ui-kit)(\/|$)/.test(source))
        return this.resolve(source, anchor, { ...options, skipSelf: true });
      // Icons: one copy of Lucide per frame, from the SDK.
      if (/^@lucide\/svelte(\/|$)/.test(source))
        return this.resolve(source, anchor, { ...options, skipSelf: true });
      if (source === "@nervekit/extension-sdk/ui")
        return join(sdkRoot, "dist", "ui.js");
      // JSX of a .tsx entry uses the extension's own React.
      if (/^react\/jsx(-dev)?-runtime$/.test(source)) {
        const resolved = await this.resolve(source, importer, {
          ...options,
          skipSelf: true,
        });
        if (!resolved)
          this.error(
            `Could not resolve '${source}': React is not installed (npm install --ignore-scripts react react-dom).`,
          );
        return resolved;
      }
      return undefined;
    },
    load(id) {
      return id === "\0nerve-frame-forbidden"
        ? "export default {};"
        : undefined;
    },
  });

  // The page is a virtual module at `<projectDir>/index.html`, so the build's root is the extension
  // folder (root-relative imports and globs, `public/`) and the output is still `index.html`.
  const htmlEntry = join(projectDir, "index.html");
  const htmlPlugin = (html: string): import("vite").Plugin => ({
    name: "nerve-frame-html",
    enforce: "pre",
    resolveId: (source) => (source === htmlEntry ? source : undefined),
    load: (id) => (id === htmlEntry ? html : undefined),
  });

  for (const frame of frames) {
    const work = join(workRoot, "ui", frame.id);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const css = [
      `@import ${JSON.stringify(join(sdkRoot, "assets", "frame.css"))};`,
      themeBlocks,
      `@import ${JSON.stringify(kitStyles("animation.css"))};`,
      `@import ${JSON.stringify(join(dirname(kitStyles("animation.css")), "components", "popover.css"))};`,
      `@source ${JSON.stringify(kitLib)};`,
      `@source ${JSON.stringify(join(projectDir, "src"))};`,
    ].join("\n");
    await writeFile(join(work, "frame.css"), css);
    await writeFile(join(work, "main.ts"), frameEntryModule(frame.entry));
    const workUrl = `/${relative(projectDir, work).split(sep).join("/")}`;
    const outDir = join(distDir, "ui", frame.id);
    try {
      await build({
        root: projectDir,
        publicDir: join(projectDir, "public"),
        configFile: false,
        logLevel: "silent",
        base: "./",
        clearScreen: false,
        oxc: { jsx: { runtime: "automatic", importSource: "react" } },
        plugins: [
          htmlPlugin(frameHtml(workUrl)),
          resolvePlugin(),
          svelte({ configFile: false, preprocess: vitePreprocess() }),
          tailwind.default(),
        ],
        build: {
          outDir,
          emptyOutDir: true,
          // The frame's CSP allows only the frame's own path: no data: URLs, no inline preload helper.
          assetsInlineLimit: 0,
          modulePreload: false,
          cssCodeSplit: false,
          sourcemap: false,
          target: "es2022",
          rollupOptions: { input: htmlEntry },
        },
      });
    } catch (cause) {
      if (forbidden.length > 0) throw new ExtensionProjectError(forbidden);
      throw new ExtensionProjectError(viteProblems(cause, frame, projectDir));
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    if (forbidden.length > 0) throw new ExtensionProjectError(forbidden);
    await checkFrameOutput(outDir, frame.id);
  }
  await rm(workRoot, { recursive: true, force: true });
}

function viteProblems(
  cause: unknown,
  frame: UiPlan["frames"][number],
  projectDir: string,
): Problem[] {
  const error = cause as {
    message?: string;
    id?: string;
    loc?: { file?: string; line?: number; column?: number };
    errors?: unknown[];
  };
  const file = error.loc?.file ?? error.id;
  const where = file
    ? `${file}${error.loc?.line ? `:${error.loc.line}:${(error.loc.column ?? 0) + 1}` : ""}`
    : relative(projectDir, frame.entry);
  const message = (error.message ?? String(cause))
    .split("\n")
    .slice(0, 8)
    .join("\n");
  const unresolved =
    /Could not resolve|Failed to resolve import|Rolldown failed to resolve/.test(
      message,
    );
  return [
    {
      what: `The UI build of '${frame.id}' failed: ${message}`,
      where,
      fix: /react\/jsx(-dev)?-runtime/.test(message)
        ? "A .tsx or .jsx file needs React: run `npm install --ignore-scripts react react-dom` in the extension folder."
        : unresolved && message.includes("@lucide/svelte")
          ? 'Import icons from "@nervekit/extension-sdk/ui" (for example `import { Copy } from "@nervekit/extension-sdk/ui"`) instead of installing @lucide/svelte.'
          : unresolved
            ? "Install the package as a dependency of the extension (npm install --ignore-scripts <name>), or correct the import path. Frames run in the browser: Node.js built-ins are not available."
            : "Fix the code at that location; UI components are Svelte 5 components (or a .ts module) that run in a browser frame.",
    },
  ];
}

/** The built frame must satisfy the frame's CSP: relative URLs only, no inline scripts. */
async function checkFrameOutput(outDir: string, id: string): Promise<void> {
  const htmlFile = join(outDir, "index.html");
  const html = await readFile(htmlFile, "utf8").catch(() => undefined);
  if (html === undefined)
    throw new ExtensionProjectError({
      what: `The UI build of '${id}' produced no index.html.`,
      where: outDir,
      fix: "Report this with the project: it is a bug in nerve-ext.",
    });
  const problems: Problem[] = [];
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html))
    problems.push({
      what: `The built page of '${id}' has an inline script, which the frame's CSP blocks.`,
      where: htmlFile,
      fix: "Report this with the project: it is a bug in nerve-ext.",
    });
  if (/(?:src|href)="(?:\/|[a-z]+:)/i.test(html))
    problems.push({
      what: `The built page of '${id}' uses absolute URLs; frames are served under a per-extension path.`,
      where: htmlFile,
      fix: "Report this with the project: it is a bug in nerve-ext.",
    });
  if (problems.length > 0) throw new ExtensionProjectError(problems);
  let bytes = 0;
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else bytes += (await stat(path)).size;
    }
  };
  await walk(outDir);
  if (bytes > extensionFileLimits.frameBytes)
    throw new ExtensionProjectError({
      what: `The UI of '${id}' is ${bytes} bytes; the host accepts at most ${extensionFileLimits.frameBytes} bytes per frame.`,
      where: outDir,
      fix: "Remove large dependencies or assets from the UI.",
    });
}

/** Copies the validated theme files into `dist/themes/`. */
export async function copyThemes(
  distDir: string,
  themes: UiPlan["themes"],
): Promise<void> {
  for (const theme of themes) {
    const target = join(distDir, theme.target);
    await mkdir(dirname(target), { recursive: true });
    await cp(theme.source, target);
  }
}
