import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const appStylesheet = fileURLToPath(
  new URL("./src/styles/app.css", import.meta.url),
);
const labDirectory = fileURLToPath(
  new URL("./src/lib/app/design-lab/", import.meta.url),
);
const labExclusion = '@source not "../lib/app/design-lab/**";';

function normalizeId(id: string): string {
  return id.split("?", 1)[0].replaceAll("\\", "/");
}

export function isDesignLabModule(id: string): boolean {
  return normalizeId(id).startsWith(
    `${normalizeId(labDirectory).replace(/\/$/, "")}/`,
  );
}

export function designLabStyles(code: string, production: boolean): string {
  if (!code.includes(labExclusion)) {
    throw new Error("App CSS must explicitly exclude Design Lab sources.");
  }
  // Negative sources override both explicit @source globs and Tailwind's
  // automatic scanning (enabled by the shared ui-kit Tailwind import).
  // An explicit directory source also includes gitignored local wireframes;
  // the broad app glob above still respects their .gitignore entry.
  return production
    ? code
    : code.replace(labExclusion, '@source "../lib/app/design-lab/wireframes";');
}

export function designLabBuildPlugin(): Plugin {
  let production = true;
  return {
    name: "nerve:design-lab-boundary",
    // Must run before @tailwindcss/vite's pre transform.
    enforce: "pre",
    configResolved(config) {
      // Match Vite's import.meta.env.DEV, not the arbitrary mode name.
      production = config.isProduction;
    },
    transform(code, id) {
      if (normalizeId(id) !== normalizeId(path.resolve(appStylesheet))) return;
      return { code: designLabStyles(code, production), map: null };
    },
    hotUpdate({ file, modules }) {
      const wireframes = `${normalizeId(labDirectory)}wireframes/`;
      if (
        !normalizeId(file).startsWith(wireframes) ||
        !/\.(svelte|ts)$/.test(file)
      ) {
        return;
      }
      // Tailwind's HMR dependency list contains only files from the previous
      // scan. Newly created ignored prototypes are not in that list yet, so
      // explicitly update the CSS entry to rescan the directory source.
      const styles =
        this.environment.moduleGraph.getModulesByFile(appStylesheet);
      if (styles?.size) return [...new Set([...modules, ...styles])];
    },
    generateBundle(_options, bundle) {
      if (!production) return;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const labModules = Object.keys(output.modules).filter(
          isDesignLabModule,
        );
        if (labModules.length > 0) {
          this.error(
            `Design Lab modules leaked into production chunk ${output.fileName}:\n${labModules.join("\n")}`,
          );
        }
      }
    },
  };
}
