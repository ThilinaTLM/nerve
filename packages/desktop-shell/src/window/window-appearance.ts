import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The renderer's active theme as far as the native shell needs it: the window
 * background (shown before any document paints) and whether the theme is dark.
 */
export interface WindowAppearance {
  background: string;
  dark: boolean;
}

export const WINDOW_APPEARANCE_FILE = "window-appearance.json";

/** Matches the renderer's default theme (`nerve-dark`). */
export const DEFAULT_WINDOW_APPEARANCE: WindowAppearance = {
  background: "#272521",
  dark: true,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Returns a normalized appearance, or undefined when the value is invalid. */
export function parseWindowAppearance(
  value: unknown,
): WindowAppearance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { background, dark } = value as Record<string, unknown>;
  if (typeof background !== "string" || !HEX_COLOR.test(background)) {
    return undefined;
  }
  if (typeof dark !== "boolean") return undefined;
  return { background: background.toLowerCase(), dark };
}

export function windowAppearanceFilePath(userDataDir: string): string {
  return join(userDataDir, WINDOW_APPEARANCE_FILE);
}

export interface WindowAppearanceFiles {
  read(path: string): string;
  write(path: string, contents: string): void;
}

const nodeFiles: WindowAppearanceFiles = {
  read: (path) => readFileSync(path, "utf8"),
  write: (path, contents) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  },
};

/** Reads the stored appearance; a missing or invalid file yields undefined. */
export function readWindowAppearance(
  path: string,
  files: Pick<WindowAppearanceFiles, "read"> = nodeFiles,
): WindowAppearance | undefined {
  try {
    return parseWindowAppearance(JSON.parse(files.read(path)));
  } catch {
    return undefined;
  }
}

export interface WindowAppearanceStore {
  current(): WindowAppearance;
  /** Persists `value` when it differs from the current one. */
  update(value: unknown): WindowAppearance | undefined;
}

/**
 * Remembers the last reported appearance so the next launch can paint the
 * right colours before the renderer loads. Writes only on change; a failed
 * write is non-fatal because the live window already updated.
 */
export function createWindowAppearanceStore(
  userDataDir: string,
  files: WindowAppearanceFiles = nodeFiles,
): WindowAppearanceStore {
  const path = windowAppearanceFilePath(userDataDir);
  let stored = readWindowAppearance(path, files);
  return {
    current: () => stored ?? DEFAULT_WINDOW_APPEARANCE,
    update(value) {
      const next = parseWindowAppearance(value);
      if (!next) return undefined;
      if (
        stored?.background !== next.background ||
        stored?.dark !== next.dark
      ) {
        stored = next;
        try {
          files.write(path, `${JSON.stringify(next)}\n`);
        } catch {
          // Best effort: the next launch falls back to the previous value.
        }
      }
      return next;
    },
  };
}
