import { readFile } from "node:fs/promises";
import { processCandidate } from "./candidates/process.js";
import { textHead } from "./measure.js";
import { profileBudget } from "./profiles.js";
import { projectAgentResult } from "./projector.js";
import type { CandidateContext } from "./types.js";

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

/** The shared process projection, including bounded line pages. Reads the whole capture for diagnostics. */
export async function projectProcessOutput(
  input: ProcessOutputInput,
): Promise<string> {
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
    const budget = profileBudget("process_diagnostics", "inline");
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
      if (
        selected.length >= budget.maxLines - 4 ||
        bytes + size > budget.maxBytes
      )
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
    return [
      `Lines ${from}-${selected.length ? next - 1 : from} of ${lines.length} (${pageStatus}).`,
      ...selected,
      ...(next < lines.length ? [`Next offset: ${next}`] : []),
      ...(reduced && (files.combined ?? files.stdout ?? files.stderr)
        ? [`File: ${files.combined ?? files.stdout ?? files.stderr}`]
        : []),
      ...(capture ? [capture] : []),
    ].join("\n");
  }
  const context: CandidateContext = {
    toolName: "bash",
    args: {},
    status: "completed",
    validatedArtifacts: [],
    result: {
      stdout: output,
      stderr: "",
      content: [processStatus, output, capture].filter(Boolean).join("\n"),
      details: {
        exitCode: input.exitCode,
        processStatusIncluded: true,
        streams: {
          combined: { lines: lines.length, bytes: Buffer.byteLength(output) },
        },
      },
    },
  };
  const candidate = processCandidate(context)!;
  candidate.status = [
    {
      type: "text",
      text: [processStatus, `Output lines: ${lines.length}`, capture]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  candidate.items = [
    ...lines.slice(0, 2).map((line) => ({
      countsAs: "event" as const,
      blocks: [{ type: "text" as const, text: line }],
    })),
    ...(candidate.items ?? []).slice(-4).map((item) => ({
      ...item,
      blocks: item.blocks.map((block) =>
        block.type === "text"
          ? { ...block, text: block.text.replace(/^\[stdout\] /, "") }
          : block,
      ),
    })),
    ...lines.slice(-2).map((line) => ({
      countsAs: "event" as const,
      blocks: [{ type: "text" as const, text: line }],
    })),
  ];
  const itemBudget = profileBudget("process_diagnostics", "overflow");
  candidate.items = candidate.items.map((item) => ({
    ...item,
    blocks: item.blocks.map((block) =>
      block.type === "text"
        ? {
            ...block,
            text: textHead(
              block.text,
              Math.min(
                itemBudget.maxItemBytes ?? 1000,
                Math.floor((itemBudget.maxBytes - 1000) / 8),
              ),
              1,
            ),
          }
        : block,
    ),
  }));
  candidate.overflow = { noun: "output line" };
  candidate.artifacts = Object.entries(files)
    .filter(([, path]) => Boolean(path))
    .map(([name, path]) => ({
      version: 1,
      id: name,
      label: name,
      role: "overflow_recovery",
      availability: "available",
      access: { kind: "agent_file", path: path },
      format: { kind: "text", mediaType: "text/plain", encoding: "utf-8" },
      size: { bytes: 0 },
      recommendedTools: ["read", "grep"],
    }));
  return projectAgentResult(context, {
    profile: "process_diagnostics",
    overflow: "compact_diagnostic",
    buildCandidate: () => candidate,
  })
    .blocks.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function projectProcessOutputPage(
  input: Omit<ProcessOutputInput, "page"> & { offset?: number; limit?: number },
): Promise<string> {
  return projectProcessOutput({
    ...input,
    page: { offset: input.offset, limit: input.limit },
  });
}
