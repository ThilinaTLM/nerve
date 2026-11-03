import { readFile } from "node:fs/promises";
import type {
  AgentProjectionSnapshot,
  ValidatedToolArtifact,
} from "@nervekit/contracts/tools";
import { profileBudget } from "./profiles.js";
import { projectAgentResult } from "./projector.js";
import type { ProjectionCandidate } from "./types.js";

export type ProcessOutputInput = {
  stdout?: string;
  stderr?: string;
  output?: string;
  outputFiles?: { stdout?: string; stderr?: string; combined?: string };
  status?: string;
  exitCode?: number | null;
  captureTruncated?: boolean;
  page?: { offset?: number; limit?: number };
};

export type ProcessOutputProjection = {
  text: string;
  /** Present for overview projections; pages are bounded reads, not reductions. */
  snapshot?: AgentProjectionSnapshot;
};

/** The shared process projection, including bounded line pages. */
export async function projectProcessOutput(
  input: ProcessOutputInput,
): Promise<string> {
  return (await projectProcessOutputResult(input)).text;
}

/** Projects process output with the same policy the tool result service applies, so a second pass is a no-op. */
export async function projectProcessOutputResult(
  input: ProcessOutputInput,
): Promise<ProcessOutputProjection> {
  const exitStatus =
    input.exitCode != null
      ? `; exit code: ${input.exitCode}`
      : input.status && input.status !== "running"
        ? "; exit code: unknown"
        : "";
  const pageStatus = `${input.status ?? "running"}${exitStatus}`;
  const processStatus = input.status
    ? `Status: ${pageStatus}`
    : input.exitCode != null
      ? `Process exit code: ${input.exitCode}.`
      : "Process output.";
  const files = input.outputFiles ?? {};
  const load = async (path: string | undefined) =>
    path ? readFile(path, "utf8").catch(() => "") : "";
  const stdout = input.stdout ?? (await load(files.stdout));
  const stderr = input.stderr ?? (await load(files.stderr));
  const output =
    input.output ??
    (files.combined
      ? await load(files.combined)
      : [stdout, stderr].filter(Boolean).join("\n"));
  const lines = output ? output.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const truncated =
    input.captureTruncated ||
    Math.max(
      Buffer.byteLength(output),
      Buffer.byteLength(stdout) + Buffer.byteLength(stderr),
    ) >=
      16 * 1024 * 1024;
  const capture = truncated ? "Capture truncated at 16 MiB." : "";
  if (input.page) {
    const { offset, limit = 100 } = input.page;
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
      throw new Error("Invalid line offset");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw new Error("Invalid line limit");
    let from = Math.min(
      lines.length,
      offset ?? Math.max(0, lines.length - limit),
    );
    // Pages stay within the overflow budget so lifecycle text around them still fits inline.
    const budget = profileBudget("process_diagnostics", "overflow");
    const selected: string[] = [];
    // Reserve the header, continuation, locator and capture notice within the same budget.
    let bytes = Buffer.byteLength(
      `Lines ${from}-${lines.length} of ${lines.length} (${pageStatus}).\nNext offset: ${lines.length}\nFile: ${files.combined ?? files.stdout ?? files.stderr ?? ""}\n${capture}\n`,
    );
    const requested = lines.slice(from, from + limit);
    for (const line of offset === undefined
      ? [...requested].reverse()
      : requested) {
      const cut = line.length > 2000 ? `${line.slice(0, 1999)}…` : line;
      const size = Buffer.byteLength(cut) + 1;
      if (selected.length >= budget.maxLines || bytes + size > budget.maxBytes)
        break;
      if (offset === undefined) selected.unshift(cut);
      else selected.push(cut);
      bytes += size;
    }
    if (offset === undefined) from = lines.length - selected.length;
    const next = from + selected.length;
    const reduced =
      from !== 0 ||
      next < lines.length ||
      selected.some((line, i) => line !== lines[from + i]);
    const text = [
      `Lines ${from}-${selected.length ? next - 1 : from} of ${lines.length} (${pageStatus}).`,
      ...selected,
      ...(next < lines.length ? [`Next offset: ${next}`] : []),
      ...(reduced && (files.combined ?? files.stdout ?? files.stderr)
        ? [`File: ${files.combined ?? files.stdout ?? files.stderr}`]
        : []),
      ...(capture ? [capture] : []),
    ].join("\n");
    return { text };
  }
  return projectProcessText({
    header: [processStatus, capture].filter(Boolean).join("\n"),
    inline: [processStatus, output, capture].filter(Boolean).join("\n"),
    output,
    files: {
      combined: files.combined
        ? { path: files.combined, text: output }
        : undefined,
      stdout: files.stdout ? { path: files.stdout, text: stdout } : undefined,
      stderr: files.stderr ? { path: files.stderr, text: stderr } : undefined,
    },
    profile: "process_diagnostics",
  });
}

type RecoveryText = { path: string; text: string };

/**
 * Projects process text with the process policy's profile and head/tail view. Producers that project before
 * the tool result service use this, so its output always fits the inline budget and the second pass is a no-op.
 */
export function projectProcessText(input: {
  /** Status lines kept whole above a reduced view. */
  header: string;
  /** The exact text shown when everything fits. */
  inline: string;
  /** Output lines that a reduced view cuts. */
  output: string;
  files: {
    combined?: RecoveryText;
    stdout?: RecoveryText;
    stderr?: RecoveryText;
  };
  profile: "process_diagnostics" | "script_output";
}): ProcessOutputProjection {
  const { combined, stdout, stderr } = input.files;
  const recovery = combined
    ? [recoveryFile("combined", combined)]
    : [
        ...(stdout ? [recoveryFile("stdout", stdout)] : []),
        ...(stderr ? [recoveryFile("stderr", stderr)] : []),
      ];
  const candidate: ProjectionCandidate = {
    blocks: [{ type: "text", text: input.inline }],
    status: input.header ? [{ type: "text", text: input.header }] : undefined,
    body: input.output,
    artifacts: recovery,
  };
  const projection = projectAgentResult(
    {
      toolName: "bash",
      args: {},
      status: "completed",
      validatedArtifacts: [],
      result: {},
    },
    {
      profile: input.profile,
      overflow: "head_tail",
      buildCandidate: () => candidate,
    },
  );
  return {
    text: projection.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n"),
    snapshot: projection.snapshot,
  };
}

function recoveryFile(
  id: "combined" | "stdout" | "stderr",
  { path, text }: RecoveryText,
): ValidatedToolArtifact {
  return {
    version: 1,
    id,
    label: id,
    role: "overflow_recovery",
    availability: "available",
    access: { kind: "agent_file", path },
    format: { kind: "text", mediaType: "text/plain", encoding: "utf-8" },
    size: { bytes: Buffer.byteLength(text) },
    recommendedTools: ["read", "grep"],
  };
}

export function projectProcessOutputPage(
  input: Omit<ProcessOutputInput, "page"> & { offset?: number; limit?: number },
): Promise<string> {
  return projectProcessOutput({
    ...input,
    page: { offset: input.offset, limit: input.limit },
  });
}
