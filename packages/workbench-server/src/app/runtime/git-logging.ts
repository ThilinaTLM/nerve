import type {
  GitCommandObservation,
  GitOverviewObservation,
  GitReadObservation,
  GithubRequestObservation,
} from "@nervekit/tools";
import type { ApplicationLogLevel } from "@nervekit/contracts";
import type { ApplicationLogContext } from "../../infrastructure/diagnostics/index.js";

export const GIT_COMMAND_SLOW_MS = 1_000;
export const GIT_READ_SLOW_MS = 1_000;
export const GITHUB_REQUEST_SLOW_MS = 1_500;
export const GIT_OVERVIEW_SLOW_MS = 2_000;

type GitDiagnostic = {
  level: ApplicationLogLevel;
  message: string;
  details: ApplicationLogContext;
};

export function gitCommandDiagnostic(
  observation: GitCommandObservation,
): GitDiagnostic | undefined {
  if (observation.succeeded && observation.durationMs < GIT_COMMAND_SLOW_MS) {
    return undefined;
  }
  const command = `${observation.bin} ${observation.command}`;
  return diagnostic(
    observation.succeeded
      ? `Slow Git command: ${command}`
      : `Git command failed: ${command}`,
    observation.durationMs,
    {
      bin: observation.bin,
      command: observation.command,
      cwd: observation.cwd,
      outcome: observation.succeeded ? "slow" : "failed",
    },
  );
}

export function gitReadDiagnostic(
  observation: GitReadObservation,
): GitDiagnostic | undefined {
  if (observation.succeeded && observation.durationMs < GIT_READ_SLOW_MS) {
    return undefined;
  }
  return diagnostic(
    observation.succeeded
      ? `Slow native Git read: ${observation.operation}`
      : `Native Git read failed: ${observation.operation}`,
    observation.durationMs,
    {
      backend: observation.backend,
      operation: observation.operation,
      repoDir: observation.repoDir,
      outcome: observation.succeeded ? "slow" : "failed",
    },
  );
}

export function githubRequestDiagnostic(
  observation: GithubRequestObservation,
): GitDiagnostic | undefined {
  if (
    observation.succeeded &&
    observation.durationMs < GITHUB_REQUEST_SLOW_MS
  ) {
    return undefined;
  }
  const repository = `${observation.owner}/${observation.repository}`;
  return diagnostic(
    observation.succeeded
      ? `Slow GitHub request: ${observation.operation}`
      : `GitHub request failed: ${observation.operation}`,
    observation.durationMs,
    {
      operation: observation.operation,
      method: observation.method,
      hostname: observation.hostname,
      repository,
      status: observation.status,
      outcome: observation.succeeded ? "slow" : "failed",
    },
  );
}

export function gitOverviewDiagnostic(
  observation: GitOverviewObservation,
): GitDiagnostic | undefined {
  if (observation.succeeded && observation.durationMs < GIT_OVERVIEW_SLOW_MS) {
    return undefined;
  }
  return diagnostic(
    observation.succeeded
      ? `Slow Git overview: ${observation.relativePath}`
      : `Git overview failed: ${observation.relativePath}`,
    observation.durationMs,
    {
      relativePath: observation.relativePath,
      outcome: observation.succeeded ? "slow" : "failed",
    },
    { projectId: observation.projectId },
  );
}

function diagnostic(
  message: string,
  durationMs: number,
  context: Record<string, unknown>,
  references: Pick<ApplicationLogContext, "projectId"> = {},
): GitDiagnostic {
  return {
    level: "warn",
    message,
    details: {
      ...references,
      durationMs: Math.round(durationMs),
      context,
    },
  };
}
