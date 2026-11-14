/**
 * Extensions benchmark: `quick_script` task suite against the test Atlassian
 * site. The step 5 gate
 * compared it with the direct Jira and Confluence tools, which are gone.
 *
 * Drives an already running dev slot through its conversation channel; it never
 * starts or stops a daemon. See README.md for flags and cost.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "../../cli/args.ts";
import { CliError, defineCli } from "../../cli/main.ts";
import {
  connectAtlassian,
  checkSandbox,
  type Atlassian,
  type Sandbox,
} from "./atlassian.ts";
import { dryRun, estimate, selftest } from "./commands.ts";
import {
  FLAGS,
  parseModels,
  parseVariants,
  type Environment,
  type Flags,
  type ModelRef,
} from "./config.ts";
import {
  createConversation,
  drive,
  ensureProject,
  loadEvents,
  newContext,
  runCleanups,
  submit,
} from "./conversation.ts";
import { DaemonClient, resolveSlotTarget } from "./daemon-client.ts";
import { analyzeEvents, finalAnswer, textOf } from "./metrics.ts";
import { decideApproval } from "./policy.ts";
import { renderSummary, type ProbeRecord, type RunRecord } from "./report.ts";
import { SMOKE_TASK, selectTasks, TASKS, validateTasks } from "./tasks.ts";
import { TaskSkipped, type TaskDefinition, type Variant } from "./types.ts";

async function executeRun(
  env: Environment,
  task: TaskDefinition,
  model: ModelRef,
  variant: Variant,
  run: number,
): Promise<RunRecord> {
  const started = Date.now();
  const record: RunRecord = {
    task: task.id,
    model: model.label,
    family: model.family,
    variant,
    run,
    status: "error",
    failures: [],
    durationMs: 0,
    approvalsApproved: 0,
    approvalsDenied: 0,
    questionsDismissed: 0,
  };
  const { ctx, cleanups } = newContext(env, task.id);
  try {
    let prompt: string;
    try {
      prompt = await task.setup(ctx);
    } catch (error) {
      if (error instanceof TaskSkipped) {
        return { ...record, status: "skipped", note: error.message };
      }
      throw error;
    }
    await mkdir(ctx.workspaceDir, { recursive: true });
    const conversationId = await createConversation(
      env,
      `[bench] ${task.id} ${variant} r${run} ${ctx.runId}`,
      ctx.workspaceDir,
      model,
      variant,
    );
    record.conversationId = conversationId;
    const baseline = await submit(env, conversationId, prompt);
    const scope = task.scope(ctx);
    const driven = await drive(
      env,
      conversationId,
      baseline,
      started + Number(env.flags["timeout-sec"]) * 1000,
      (call) => decideApproval(call, scope, env.sandbox).decision,
    );
    record.approvalsApproved = driven.approved;
    record.approvalsDenied = driven.denied;
    record.questionsDismissed = driven.questions;
    const events = await loadEvents(env, conversationId);
    record.metrics = analyzeEvents(variant, events);
    const answer = finalAnswer(events);
    const toolCalls = events
      .filter((event) => event.type === "tool_call_response")
      .map((event) => ({
        name: event.payload.toolName as string,
        ok: event.payload.outcome === "completed",
        text: textOf(event.payload.agentProjection),
      }));
    if (driven.state !== "done") {
      record.status = "failed";
      record.failures.push(driven.note ?? driven.state);
    } else {
      const check = await task.check(ctx, { answer, toolCalls });
      record.status = check.pass ? "passed" : "failed";
      record.failures.push(...check.failures);
    }
    if (env.flags["delete-conversations"])
      await env.client
        .call("conversation.delete", { conversationId })
        .catch(() => undefined);
  } catch (error) {
    record.status = "error";
    record.note = (error as Error).message;
  } finally {
    const problems = await runCleanups(cleanups);
    if (problems.length)
      record.note = [record.note, ...problems].filter(Boolean).join("; ");
    record.durationMs = Date.now() - started;
  }
  return record;
}

/** One trivial request per model and variant; the difference isolates tool-definition tokens. */
async function probeToolSurface(
  env: Environment,
  model: ModelRef,
  variant: Variant | "none",
): Promise<ProbeRecord> {
  const conversationId = await createConversation(
    env,
    `[bench] probe ${variant}`,
    env.projectDir,
    model,
    variant,
  );
  const baseline = await submit(
    env,
    conversationId,
    "Reply with the single word: ok",
  );
  const driven = await drive(
    env,
    conversationId,
    baseline,
    Date.now() + 180_000,
    () => "deny",
  );
  if (driven.state !== "done")
    throw new Error(`probe ${variant}: ${driven.note ?? driven.state}`);
  const metrics = analyzeEvents(
    "quick_script",
    await loadEvents(env, conversationId),
  );
  await env.client
    .call("conversation.delete", { conversationId })
    .catch(() => undefined);
  return {
    model: model.label,
    family: model.family,
    variant,
    firstRequestInputTokens: metrics.firstRequestInputTokens,
  };
}

async function writeResults(
  dir: string,
  flags: Flags,
  records: RunRecord[],
  probes: ProbeRecord[],
): Promise<void> {
  const meta = {
    slot: Number(flags.slot),
    ruleSet: flags["rule-set"]!,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(
    join(dir, "results.json"),
    JSON.stringify({ meta, probes, records }, null, 2),
  );
  await writeFile(
    join(dir, "summary.md"),
    renderSummary(records, probes, meta),
  );
}

async function main(argv: string[]): Promise<void> {
  const flags = parseCli("run.ts", FLAGS, argv);
  const slot = Number(flags.slot);
  const target = resolveSlotTarget(slot);
  const variants = parseVariants(flags.variant!);
  const runs = Number(flags.runs);
  if (!Number.isInteger(runs) || runs < 1)
    throw new CliError("--runs must be a positive integer.");
  const dry = flags["dry-run"];
  const models = dry && !flags.model ? [] : parseModels(flags.model);
  const taskIds = flags.smoke
    ? [SMOKE_TASK]
    : flags.tasks?.split(",").map((id) => id.trim());
  const tasks = selectTasks(taskIds);
  const problems = validateTasks(TASKS);
  if (problems.length && !dry)
    throw new CliError(`Invalid task file:\n  ${problems.join("\n  ")}`);
  const sandbox: Sandbox = {
    jiraProject: flags["jira-project"]!,
    confluenceSpace: flags.space!,
  };

  const client = await DaemonClient.connect(target);
  try {
    let atlassian: Atlassian | undefined;
    let atlassianProblem: string | undefined;
    try {
      atlassian = await connectAtlassian(target, sandbox);
    } catch (error) {
      atlassianProblem = (error as Error).message;
      if (!dry) throw error;
    }
    if (dry) {
      await dryRun(
        flags,
        client,
        atlassian,
        atlassianProblem,
        tasks,
        models,
        variants,
      );
      return;
    }
    const sandboxProblems = await checkSandbox(atlassian!);
    if (sandboxProblems.length)
      throw new CliError(
        `Sandbox unavailable:\n  ${sandboxProblems.join("\n  ")}`,
      );

    const projectDir = join(tmpdir(), `nerve-ext-bench-slot-${slot}`);
    // The selftest needs no daemon state: it never creates a project or conversation.
    const project = flags.selftest
      ? { id: "", directory: projectDir }
      : await ensureProject(client, flags.project!, projectDir, true);
    const env: Environment = {
      client,
      atlassian,
      sandbox,
      flags,
      projectId: project!.id,
      projectDir: project!.directory,
    };
    if (flags.selftest) {
      await selftest(env, tasks);
      return;
    }

    const activeModels = flags.smoke ? models.slice(0, 1) : models;
    const outDir = join(
      flags.out!,
      new Date().toISOString().replaceAll(":", "-").replace(/\..+/, ""),
    );
    await mkdir(outDir, { recursive: true });
    const total = estimate(
      tasks,
      activeModels.length,
      variants.length,
      flags.smoke ? 1 : runs,
    );
    console.log(
      `Running ${total.runs} runs (~${total.modelCalls} model calls) on slot ${slot}; results in ${outDir}`,
    );
    const records: RunRecord[] = [];
    const probes: ProbeRecord[] = [];
    if (!flags["no-probe"] && !flags.smoke)
      for (const model of activeModels)
        for (const variant of ["none", ...variants] as const) {
          probes.push(await probeToolSurface(env, model, variant));
          console.log(
            `probe ${model.label} ${variant}: ${probes.at(-1)!.firstRequestInputTokens} input tokens`,
          );
        }
    const perTask = flags.smoke ? 1 : runs;
    for (let run = 1; run <= perTask; run++)
      for (const task of tasks)
        for (const model of activeModels)
          for (const variant of variants) {
            const record = await executeRun(env, task, model, variant, run);
            records.push(record);
            console.log(
              `${record.status.padEnd(7)} ${task.id} ${variant} ${model.label} run ${run}${record.failures.length ? `: ${record.failures.join("; ")}` : ""}${record.note ? ` (${record.note})` : ""}`,
            );
            await writeResults(outDir, flags, records, probes);
          }
    console.log(`\nDone. ${join(outDir, "summary.md")}`);
  } finally {
    await client.close();
  }
}

defineCli(import.meta.url, main);
