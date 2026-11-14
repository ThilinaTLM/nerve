import type { RunMetrics } from "./metrics.ts";
import type { Variant } from "./types.ts";

export interface RunRecord {
  task: string;
  model: string;
  family: string;
  variant: Variant;
  run: number;
  /** `skipped` runs never reached the model. */
  status: "passed" | "failed" | "error" | "skipped";
  failures: string[];
  durationMs: number;
  conversationId?: string;
  metrics?: RunMetrics;
  approvalsApproved: number;
  approvalsDenied: number;
  questionsDismissed: number;
  note?: string;
}

/** Tool-surface measurement per (model, variant) from the trivial probe conversation. */
export interface ProbeRecord {
  model: string;
  family: string;
  variant: Variant | "none";
  /** Input + cache tokens of the first request of "Reply with ok". */
  firstRequestInputTokens: number;
}

export function modelFamily(model: string): string {
  if (/faux/i.test(model)) return "Faux";
  if (/claude|anthropic|opus|sonnet|haiku|fable/i.test(model)) return "Claude";
  if (/gpt|openai|codex|\bo\d/i.test(model)) return "GPT";
  return model.split("/")[0] ?? model;
}

export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const mean = (values: readonly number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;

function fmt(value: number | undefined, digits = 0): string {
  if (value === undefined || Number.isNaN(value)) return "–";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join(
    "\n",
  );
}

function group<T>(items: readonly T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return groups;
}

/** Tool-definition tokens per request: probe input with the variant minus probe input with no extra tools. */
export function toolSurfaceTokens(
  probes: readonly ProbeRecord[],
  model: string,
  variant: Variant,
): number | undefined {
  const withTools = probes.find(
    (probe) => probe.model === model && probe.variant === variant,
  );
  const baseline = probes.find(
    (probe) => probe.model === model && probe.variant === "none",
  );
  return withTools && baseline
    ? withTools.firstRequestInputTokens - baseline.firstRequestInputTokens
    : undefined;
}

function summarize(
  records: readonly RunRecord[],
  probes: readonly ProbeRecord[],
) {
  const ran = records.filter((record) => record.status !== "skipped");
  const metrics = ran.flatMap((record) =>
    record.metrics ? [record.metrics] : [],
  );
  const sum = (pick: (m: RunMetrics) => number) =>
    metrics.reduce((total, m) => total + pick(m), 0);
  const surface = [
    ...new Set(ran.map((record) => `${record.model}\n${record.variant}`)),
  ].flatMap((id) => {
    const [model, variant] = id.split("\n") as [string, Variant];
    const value = toolSurfaceTokens(probes, model, variant);
    return value === undefined ? [] : [value];
  });
  return {
    runs: ran.length,
    passed: ran.filter((record) => record.status === "passed").length,
    turns: median(metrics.map((m) => m.turns)),
    totalTokens: median(metrics.map((m) => m.totalTokens)),
    surface: median(surface),
    beforeFirst: median(
      metrics.flatMap((m) =>
        m.tokensBeforeFirstSdkSuccess === undefined
          ? []
          : [m.tokensBeforeFirstSdkSuccess],
      ),
    ),
    wrongArguments: mean(metrics.map((m) => m.failedWrongArguments)),
    unavailable: mean(metrics.map((m) => m.unavailableNamespaceCalls)),
    approvals: mean(metrics.map((m) => m.approvalsRequested)),
    denied: sum((m) => m.approvalsDenied),
  };
}

const HEADER = [
  "Success",
  "Turns (med)",
  "Tool-def tokens/request",
  "Total tokens (med)",
  "Tokens before 1st SDK success (med)",
  "Wrong-arg/unknown-method failures per run",
  "Unavailable-namespace calls per run",
  "Approvals per run",
  "Denied",
];

function summaryCells(s: ReturnType<typeof summarize>): string[] {
  return [
    s.runs ? `${s.passed}/${s.runs} (${fmt((100 * s.passed) / s.runs)}%)` : "–",
    fmt(s.turns, 1),
    fmt(s.surface),
    fmt(s.totalTokens),
    fmt(s.beforeFirst),
    fmt(s.wrongArguments, 2),
    fmt(s.unavailable, 2),
    fmt(s.approvals, 2),
    fmt(s.denied),
  ];
}

/** Markdown report: variants per model family, then per task. */
export function renderSummary(
  records: readonly RunRecord[],
  probes: readonly ProbeRecord[],
  meta: { slot: number; generatedAt: string; ruleSet: string },
): string {
  const lines = [
    "# Extensions benchmark: quick_script",
    "",
    `Slot ${meta.slot}, rule set \`${meta.ruleSet}\`, generated ${meta.generatedAt}. ${records.length} runs.`,
    "",
    "Tool-def tokens/request = first-request input tokens of a trivial prompt with quick_script minus the same prompt with it off.",
    "",
  ];

  lines.push("## By model family", "");
  const byFamily = group(records, (record) => record.family);
  for (const [family, familyRecords] of byFamily) {
    lines.push(`### ${family}`, "");
    const rows: string[][] = [];
    for (const [variant, variantRecords] of group(
      familyRecords,
      (r) => r.variant,
    )) {
      const s = summarize(variantRecords, probes);
      rows.push([variant, ...summaryCells(s)]);
    }
    lines.push(table(["Variant", ...HEADER], rows), "");
  }

  lines.push("## By task", "");
  const rows: string[][] = [];
  for (const [family, familyRecords] of byFamily)
    for (const [task, taskRecords] of group(familyRecords, (r) => r.task))
      for (const [variant, variantRecords] of group(
        taskRecords,
        (r) => r.variant,
      )) {
        const s = summarize(variantRecords, probes);
        const skipped = variantRecords.filter(
          (r) => r.status === "skipped",
        ).length;
        rows.push([
          family,
          task,
          variant,
          ...summaryCells(s),
          skipped ? `${skipped} skipped` : "",
        ]);
      }
  lines.push(
    table(["Family", "Task", "Variant", ...HEADER, "Notes"], rows),
    "",
  );

  const failing = records.filter(
    (record) => record.status === "failed" || record.status === "error",
  );
  if (failing.length) {
    lines.push("## Failures", "");
    for (const record of failing)
      lines.push(
        `- ${record.task} · ${record.variant} · ${record.model} · run ${record.run} (${record.status}${record.conversationId ? `, ${record.conversationId}` : ""}): ${[...record.failures, record.note].filter(Boolean).join("; ")}`,
      );
    lines.push("");
  }
  return lines.join("\n");
}
