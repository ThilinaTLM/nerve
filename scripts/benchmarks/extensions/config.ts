/** Flags, model and variant parsing, and per-conversation overrides. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "../../cli/args.ts";
import { CliError } from "../../cli/main.ts";
import { DEFAULT_SANDBOX, type Atlassian, type Sandbox } from "./atlassian.ts";
import type { DaemonClient } from "./daemon-client.ts";
import { modelFamily } from "./report.ts";
import { SMOKE_TASK } from "./tasks.ts";
import { VARIANTS, type Variant } from "./types.ts";

export const FLAGS = {
  slot: {
    type: "string",
    description: "Dev slot to drive (2-100, required; slot 1 is refused).",
  },
  variant: {
    type: "string",
    description:
      "quick_script, direct, or a comma list (default: quick_script,direct).",
    default: "quick_script,direct",
  },
  model: {
    type: "string",
    description:
      "provider/modelId, or a comma list (one per model family to compare).",
  },
  runs: {
    type: "string",
    description: "Runs per task, variant and model.",
    default: "5",
  },
  tasks: {
    type: "string",
    description: "Comma list of task ids (default: all).",
  },
  "dry-run": {
    type: "boolean",
    description:
      "Validate tasks, slot, models, rule set and sandbox; no model calls.",
  },
  smoke: {
    type: "boolean",
    description: `Run ${SMOKE_TASK} once on the first model (and listed variants).`,
  },
  selftest: {
    type: "boolean",
    description:
      "Create, check and clean up each selected task's fixtures without a model (writes to the sandbox).",
  },
  "rule-set": {
    type: "string",
    description: "Permission rule set id for the conversations.",
    default: "supervised",
  },
  reasoning: {
    type: "string",
    description: "Reasoning level override (default: configured).",
  },
  "jira-project": {
    type: "string",
    description: "Sandbox Jira project key.",
    default: DEFAULT_SANDBOX.jiraProject,
  },
  space: {
    type: "string",
    description: "Sandbox Confluence space key.",
    default: DEFAULT_SANDBOX.confluenceSpace,
  },
  project: {
    type: "string",
    description: "Nerve project name used for the benchmark conversations.",
    default: "extensions-benchmark",
  },
  out: {
    type: "string",
    description: "Output directory for results.json and summary.md.",
    default: join(tmpdir(), "nerve-bench", "extensions"),
  },
  "timeout-sec": {
    type: "string",
    description: "Wall-clock limit per run.",
    default: "900",
  },
  "no-probe": {
    type: "boolean",
    description: "Skip the tool-definition token probe conversations.",
  },
  "delete-conversations": {
    type: "boolean",
    description: "Delete each benchmark conversation after its run.",
  },
} as const;

export type Flags = ReturnType<typeof parseCli<typeof FLAGS>>;

export interface ModelRef {
  readonly provider: string;
  readonly modelId: string;
  readonly label: string;
  readonly family: string;
}

export function parseModels(value: string | undefined): ModelRef[] {
  if (!value) throw new CliError("--model <provider/modelId[,…]> is required.");
  return value.split(",").map((entry) => {
    const slash = entry.indexOf("/");
    if (slash < 1 || slash === entry.length - 1)
      throw new CliError(
        `--model entries are provider/modelId, got "${entry}".`,
      );
    return {
      provider: entry.slice(0, slash),
      modelId: entry.slice(slash + 1),
      label: entry,
      family: modelFamily(entry),
    };
  });
}

export function parseVariants(value: string): Variant[] {
  const variants = value.split(",").map((entry) => entry.trim());
  for (const variant of variants)
    if (!VARIANTS.includes(variant as Variant))
      throw new CliError(
        `Unknown variant "${variant}"; use quick_script or direct.`,
      );
  return variants as Variant[];
}

/** Tool enablement per conversation: only the variant's Atlassian surface differs. */
export function toolOverrides(variant: Variant | "none") {
  const direct = variant === "direct";
  return {
    quick_script: { enabled: variant === "quick_script" },
    jira: { enabled: direct },
    confluence: { enabled: direct },
    kroki_export: { enabled: direct },
    web_search: { enabled: false },
    web_fetch: { enabled: false },
    subagents: { enabled: false },
    generate_image: { enabled: false },
    explain_image: { enabled: false },
    plan_present: { enabled: false },
  };
}

export function overridesFor(
  flags: Flags,
  model: ModelRef,
  variant: Variant | "none",
) {
  return {
    model: { provider: model.provider, modelId: model.modelId },
    permissionRuleSetId: flags["rule-set"],
    ...(flags.reasoning ? { reasoningLevel: flags.reasoning } : {}),
    tools: toolOverrides(variant),
  };
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface Environment {
  readonly client: DaemonClient;
  readonly atlassian: Atlassian | undefined;
  readonly sandbox: Sandbox;
  readonly flags: Flags;
  readonly projectId: string;
  readonly projectDir: string;
}
