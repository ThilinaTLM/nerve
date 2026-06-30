import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { buildProcessTextResult } from "../common/process-result.js";

export async function writeJiraArtifact(
  context: ToolExecutionContext,
  kind: string,
  payload: unknown,
): Promise<{ path: string; bytes: number; chars: number; lines: number }> {
  const baseDir = context.dataDir
    ? join(context.dataDir, "tmp", "jira")
    : join(tmpdir(), "nerve-jira");
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const text = JSON.stringify(payload, null, 2);
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 10);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(baseDir, `${kind}-${timestamp}-${hash}.json`);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  return {
    path,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

export async function buildJiraTextResult({
  text,
  context,
  details = {},
  artifact,
}: {
  text: string;
  context: ToolExecutionContext;
  details?: Record<string, unknown>;
  artifact?: { path: string; bytes: number; chars: number; lines: number };
}): Promise<ToolExecutionResult> {
  const outputLimits = artifact
    ? {
        ...((details.outputLimits as Record<string, unknown> | undefined) ??
          {}),
        artifacts: [
          ...(((details.outputLimits as { artifacts?: unknown[] } | undefined)
            ?.artifacts as unknown[] | undefined) ?? []),
          {
            kind: "raw_result",
            path: artifact.path,
            label: "Raw Jira JSON",
            bytes: artifact.bytes,
            chars: artifact.chars,
            lines: artifact.lines,
          },
        ],
      }
    : details.outputLimits;
  return buildProcessTextResult({
    text,
    outputFilePrefix: "nerve-jira",
    exitMessagePrefix: "Jira",
    dataDir: context.dataDir,
    details: { ...details, ...(outputLimits ? { outputLimits } : {}) },
  });
}

export function issueLine(issue: unknown): string {
  if (!issue || typeof issue !== "object") return JSON.stringify(issue);
  const record = issue as Record<string, unknown>;
  const fields = (record.fields ?? {}) as Record<string, unknown>;
  const status = nameOf(fields.status);
  const assignee = displayNameOf(fields.assignee);
  const summary = typeof fields.summary === "string" ? fields.summary : "";
  const type = nameOf(fields.issuetype);
  const key =
    typeof record.key === "string" ? record.key : String(record.id ?? "?");
  const parts = [
    key,
    type,
    status,
    assignee ? `assignee: ${assignee}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}${summary ? ` — ${summary}` : ""}`;
}

export function nameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

function displayNameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.displayName === "string"
    ? record.displayName
    : nameOf(value);
}

export function transitionLine(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const to = nameOf(record.to);
  const id =
    typeof record.id === "string" ? record.id : String(record.id ?? "?");
  const name = typeof record.name === "string" ? record.name : "(unnamed)";
  return `- ${id} · ${name}${to ? ` → ${to}` : ""}`;
}
