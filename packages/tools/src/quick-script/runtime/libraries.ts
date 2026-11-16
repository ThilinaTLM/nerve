import { readSandboxLibrarySource } from "../sandbox-library-sources.js";
import { MAMMOTH_WRAPPER, PPTX_TEXT } from "./files/documents.js";

/**
 * Third-party libraries scripts can use as globals. Each is evaluated inside
 * the sandbox on first access, and only scripts that mention the global get it
 * defined at all, so everyone else pays nothing.
 */
type Library = {
  global: string;
  file: string;
  /** Other globals the same file defines; their lazy getters must not shadow it. */
  also?: readonly string[];
  /** Sandbox code run right after the file loads. */
  after?: string;
};

const LIBRARIES: readonly Library[] = [
  // SheetJS Community Edition from the official CDN tarball (npm's `xlsx` is stale).
  { global: "XLSX", file: "xlsx.full.min.js" },
  { global: "Papa", file: "papaparse.min.js" },
  { global: "docx", file: "docx.min.js" },
  {
    global: "mammoth",
    file: "mammoth.browser.min.js",
    after: MAMMOTH_WRAPPER,
  },
  // The bundle build is the only one that includes JSZip.
  {
    global: "PptxGenJS",
    file: "pptxgen.bundle.js",
    also: ["JSZip"],
  },
  { global: "JSZip", file: "jszip.min.js" },
];

/** Plain helper functions defined eagerly (when mentioned), with the library globals they use. */
const HELPERS = [{ global: "pptxText", source: PPTX_TEXT, needs: "JSZip" }];

const mentions = (code: string, name: string) =>
  new RegExp(`\\b${name}\\b`).test(code);

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
  const helpers = HELPERS.filter((helper) => mentions(code, helper.global));
  const libraries = LIBRARIES.filter(
    (library) =>
      mentions(code, library.global) ||
      helpers.some((helper) => helper.needs === library.global),
  );
  const parts = libraries.map((library) => {
    const name = JSON.stringify(library.global);
    const owned = [library.global, ...(library.also ?? [])]
      .map((global) => `delete globalThis[${JSON.stringify(global)}];`)
      .join(" ");
    const source = JSON.stringify(librarySource(library.file));
    const after = library.after
      ? ` (0, eval)(${JSON.stringify(library.after)});`
      : "";
    // Indirect eval runs in the global scope; the getter replaces itself with the real global.
    return `Object.defineProperty(globalThis, ${name}, { configurable: true, get() { ${owned} (0, eval)(${source});${after} return globalThis[${name}]; } });`;
  });
  return [...parts, ...helpers.map((helper) => helper.source)].join("\n");
}
