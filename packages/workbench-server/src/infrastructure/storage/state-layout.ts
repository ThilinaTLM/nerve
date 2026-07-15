import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathExists, writeTextFileIfMissing } from "./json.js";

export const WORKBENCH_STATE_FORMAT = "nerve-workbench-state";
export const WORKBENCH_STATE_VERSION = 2;

const desktopBootstrapDirectories = new Set(["crashes", "desktop", "logs"]);

export type WorkbenchHomeInspection =
  | { kind: "missing" | "empty" | "desktop-bootstrap" | "current" }
  | { kind: "legacy"; reason: string }
  | { kind: "unsupported"; reason: string };

export async function inspectWorkbenchHome(
  home: string,
): Promise<WorkbenchHomeInspection> {
  let entries;
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" };
    throw error;
  }

  const markerPath = join(home, "VERSION");
  if (await pathExists(markerPath)) {
    let marker: { format?: unknown; version?: unknown };
    try {
      marker = JSON.parse(await readFile(markerPath, "utf8")) as {
        format?: unknown;
        version?: unknown;
      };
    } catch {
      return {
        kind: "unsupported",
        reason: "The workbench state VERSION marker is unreadable or invalid.",
      };
    }

    if (
      marker.format !== WORKBENCH_STATE_FORMAT ||
      marker.version !== WORKBENCH_STATE_VERSION
    ) {
      return {
        kind: "unsupported",
        reason: `The workbench state VERSION marker is not ${WORKBENCH_STATE_FORMAT} version ${WORKBENCH_STATE_VERSION}.`,
      };
    }

    const retiredProcesses = join(home, "proc");
    if (await pathExists(retiredProcesses)) {
      try {
        if ((await readdir(retiredProcesses)).length > 0) {
          return {
            kind: "unsupported",
            reason: "The workbench state contains retired process state.",
          };
        }
      } catch {
        return {
          kind: "unsupported",
          reason: "The retired process-state path is not a readable directory.",
        };
      }
    }
    return { kind: "current" };
  }

  if (entries.length === 0) return { kind: "empty" };
  const containsOnlyDesktopBootstrapData = entries.every(
    (entry) =>
      entry.isDirectory() && desktopBootstrapDirectories.has(entry.name),
  );
  if (containsOnlyDesktopBootstrapData) return { kind: "desktop-bootstrap" };

  return {
    kind: "legacy",
    reason: "The workbench home contains unversioned legacy state.",
  };
}

export async function ensureStateLayout(home: string): Promise<void> {
  const inspection = await inspectWorkbenchHome(home);
  if (inspection.kind === "current") return;
  if (
    inspection.kind === "missing" ||
    inspection.kind === "empty" ||
    inspection.kind === "desktop-bootstrap"
  ) {
    await writeTextFileIfMissing(
      join(home, "VERSION"),
      `${JSON.stringify(
        {
          format: WORKBENCH_STATE_FORMAT,
          version: WORKBENCH_STATE_VERSION,
        },
        null,
        2,
      )}\n`,
      0o600,
    );
    return;
  }
  throw incompatibleStateError(home);
}

export function incompatibleStateError(home: string): Error {
  return new Error(
    `Incompatible Nerve state at ${home}. Reset this directory before starting Nerve Protocol v1.`,
  );
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
