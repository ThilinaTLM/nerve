import { readSandboxLibrarySource } from "../../sandbox-library-sources.js";

/**
 * Third-party libraries scripts can use as globals. Each is evaluated inside
 * the sandbox on first access, and only scripts that mention the global get it
 * defined at all, so everyone else pays nothing.
 */
const LIBRARIES = [
  // SheetJS Community Edition from the official CDN tarball (npm's `xlsx` is stale).
  { global: "XLSX", file: "xlsx.full.min.js" },
  { global: "Papa", file: "papaparse.min.js" },
] as const;

const sources = new Map<string, string>();

function librarySource(file: string): string {
  let source = sources.get(file);
  if (source === undefined) {
    source = readSandboxLibrarySource(file);
    sources.set(file, source);
  }
  return source;
}

/** Classic-script prelude defining lazy getters for the libraries `code` mentions. */
export function librariesPrelude(code: string): string {
  return LIBRARIES.filter((library) =>
    new RegExp(`\\b${library.global}\\b`).test(code),
  )
    .map((library) => {
      const name = JSON.stringify(library.global);
      const source = JSON.stringify(librarySource(library.file));
      // Indirect eval runs in the global scope; the getter replaces itself with the real global.
      return `Object.defineProperty(globalThis, ${name}, { configurable: true, get() { delete globalThis[${name}]; (0, eval)(${source}); return globalThis[${name}]; } });`;
    })
    .join("\n");
}
