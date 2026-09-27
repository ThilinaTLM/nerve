import type {
  HomeMigrationFailure,
  HomeMigrationFailureReport,
  HomeMigrationQuarantineSummary,
  HomeMigrationStepSummary,
} from "@nervekit/contracts/storage";
import { homeMigrationFailureReportSchema } from "@nervekit/contracts/storage";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";

export async function writeStorageMigrationFailureReport(
  path: string,
  input: {
    runId: string;
    planFingerprint?: string;
    failedAt: Date;
    failure: HomeMigrationFailure;
    steps: HomeMigrationStepSummary[];
    quarantine?: HomeMigrationQuarantineSummary;
  },
): Promise<HomeMigrationFailureReport> {
  const report = homeMigrationFailureReportSchema.parse({
    format: "nerve-home-migration-failure",
    version: 1,
    runId: input.runId,
    planFingerprint: input.planFingerprint,
    failedAt: input.failedAt.toISOString(),
    failure: redactFailure(input.failure),
    steps: input.steps,
    quarantine: input.quarantine,
  });
  await atomicWriteJson(path, report, 0o600);
  return report;
}

function redactFailure(failure: HomeMigrationFailure): HomeMigrationFailure {
  return {
    ...failure,
    message: redact(failure.message),
    ...(failure.cause ? { cause: redact(failure.cause) } : {}),
  };
}

function redact(value: string): string {
  return value
    .replace(/nt_[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(
      /(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi,
      "$1=[redacted]",
    );
}
