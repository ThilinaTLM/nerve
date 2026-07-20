import { access, rename } from "node:fs/promises";
import { join } from "node:path";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import {
  DaemonStartupError,
  isDaemonStartupErrorCode,
} from "../daemon/diagnostics.js";

const RUN_REVISION_CONFLICT = "RUN_REVISION_CONFLICT";
const CORRUPT_RUN_JOURNAL = "Corrupt run journal";

export interface RunRuntimeRecoveryResult<T> {
  value: T;
  recovery?: { backupPath: string };
}

export interface RunRuntimeRecoveryDependencies {
  showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<Pick<MessageBoxReturnValue, "response">>;
  rename?: (source: string, destination: string) => Promise<void>;
  pathExists?: (path: string) => Promise<boolean>;
  now?: () => Date;
}

export class RunRuntimeRecoveryError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "RunRuntimeRecoveryError";
  }
}

export async function startWithRunRuntimeRecovery<T>(
  input: { home: string; start: () => Promise<T> },
  dependencies: RunRuntimeRecoveryDependencies,
): Promise<RunRuntimeRecoveryResult<T>> {
  try {
    return { value: await input.start() };
  } catch (error) {
    if (!isRecoverableRunRuntimeStartupError(error)) throw error;

    const confirmation = await dependencies.showMessageBox({
      type: "warning",
      title: "Repair Nerve run data",
      message: "Nerve found inconsistent or unreadable local run history.",
      detail: [
        "Nerve can move the complete run-runtime directory to a retained timestamped backup, then retry startup with fresh run data.",
        "Settings, projects, conversations, providers, and authentication will not be changed.",
        "The backup will never be deleted automatically.",
      ].join("\n\n"),
      buttons: ["Back up run data and retry", "Not now"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) throw error;

    let backupPath: string;
    try {
      backupPath = await backupRunRuntime(input.home, dependencies);
    } catch (backupError) {
      throw new RunRuntimeRecoveryError(
        `Nerve could not back up its run data in ${input.home}. No run data was intentionally deleted.`,
        { cause: backupError },
      );
    }

    return {
      value: await input.start(),
      recovery: { backupPath },
    };
  }
}

function isRecoverableRunRuntimeStartupError(error: unknown): boolean {
  return (
    isDaemonStartupErrorCode(error, RUN_REVISION_CONFLICT) ||
    (error instanceof DaemonStartupError &&
      error.daemonOutput.includes(CORRUPT_RUN_JOURNAL))
  );
}

async function backupRunRuntime(
  home: string,
  dependencies: RunRuntimeRecoveryDependencies,
): Promise<string> {
  const source = join(home, "run-runtime");
  const backupPath = await allocateBackupPath(
    home,
    (dependencies.now ?? (() => new Date()))(),
    dependencies.pathExists ?? pathExists,
  );
  await (dependencies.rename ?? rename)(source, backupPath);
  return backupPath;
}

async function allocateBackupPath(
  home: string,
  now: Date,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const base = join(home, `run-runtime-bk-${formatBackupTimestamp(now)}`);
  let candidate = base;
  let suffix = 2;
  while (await exists(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function formatBackupTimestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(
      "Cannot create a run-data backup name from an invalid date.",
    );
  }
  const compact = value.toISOString().replaceAll(/[-:]/g, "");
  return `${compact.slice(0, 8)}-${compact.slice(9, 15)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
