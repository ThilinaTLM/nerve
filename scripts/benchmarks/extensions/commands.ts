/** Dry run, selftest and cost estimate. */
import { CliError } from "../../cli/main.ts";
import { checkSandbox, type Atlassian } from "./atlassian.ts";
import { ensureProject, newContext, runCleanups } from "./conversation.ts";
import {
  overridesFor,
  type Environment,
  type Flags,
  type ModelRef,
} from "./config.ts";
import type { DaemonClient } from "./daemon-client.ts";
import { TASKS, validateTasks } from "./tasks.ts";
import { TaskSkipped, type TaskDefinition, type Variant } from "./types.ts";

interface Estimate {
  runs: number;
  modelCalls: number;
}

export function estimate(
  tasks: readonly TaskDefinition[],
  models: number,
  variants: number,
  runs: number,
): Estimate {
  const perPass = tasks.reduce(
    (sum, task) => sum + task.estimatedModelCalls,
    0,
  );
  return {
    runs: tasks.length * models * variants * runs,
    modelCalls: perPass * models * variants * runs,
  };
}

export async function dryRun(
  flags: Flags,
  client: DaemonClient,
  atlassian: Atlassian | undefined,
  atlassianProblem: string | undefined,
  tasks: readonly TaskDefinition[],
  models: ModelRef[],
  variants: Variant[],
): Promise<void> {
  const problems: string[] = [];
  const say = (line: string) => console.log(line);
  problems.push(...validateTasks(TASKS));
  say(`Tasks (${tasks.length}):`);
  for (const task of tasks)
    say(
      `  ${task.id.padEnd(26)} ${task.category.padEnd(9)} ~${task.estimatedModelCalls} model calls  ${task.title}`,
    );

  say(`\nSlot ${flags.slot}: connected (${client.target.baseUrl}).`);
  const listed = await client.call<{
    models: { provider: string; modelId: string }[];
  }>("model.list", {});
  for (const model of models)
    if (
      !listed.models.some(
        (m) => m.provider === model.provider && m.modelId === model.modelId,
      )
    )
      problems.push(
        `model ${model.label} is not available on slot ${flags.slot}`,
      );
    else say(`Model ${model.label} (${model.family}): available.`);
  const ruleSets = await client.call<{ ruleSets: { id: string }[] }>(
    "permissionRuleSet.list",
    {},
  );
  if (!ruleSets.ruleSets.some((set) => set.id === flags["rule-set"]))
    problems.push(
      `rule set ${flags["rule-set"]} not found (have: ${ruleSets.ruleSets.map((set) => set.id).join(", ")})`,
    );
  else say(`Rule set ${flags["rule-set"]}: found.`);
  const { tools } = await client.call<{ tools: { name: string }[] }>(
    "tool.list",
    {},
  );
  for (const name of ["quick_script"])
    if (!tools.some((tool) => tool.name === name))
      problems.push(`tool ${name} is not registered on slot ${flags.slot}`);

  const project = await ensureProject(client, flags.project!, "", false);
  const projects = await client.call<{ id: string; directory: string }[]>(
    "project.list",
    {},
  );
  const preview = project ?? projects[0];
  say(
    project
      ? `Project "${flags.project}": exists.`
      : `Project "${flags.project}": will be created on the first real run (previewing with an existing project).`,
  );
  if (preview && models[0])
    for (const variant of variants) {
      const answer = await client
        .call<{ status: string; systemPrompt?: string }>(
          "conversation.previewSystemPrompt",
          {
            projectId: preview.id,
            overrides: overridesFor(flags, models[0], variant),
            config: { workingDirectory: preview.directory },
          },
        )
        .catch((error: unknown) => ({
          status: `error: ${(error as Error).message}`,
          systemPrompt: undefined,
        }));
      if (answer.status !== "available")
        problems.push(
          `variant ${variant}: system prompt preview ${answer.status}`,
        );
      else
        say(
          `Variant ${variant}: configuration accepted, system prompt ${answer.systemPrompt!.length} chars.`,
        );
    }

  if (!atlassian) problems.push(`Atlassian: ${atlassianProblem}`);
  else {
    const sandboxProblems = await checkSandbox(atlassian);
    problems.push(...sandboxProblems);
    if (!sandboxProblems.length)
      say(
        `Atlassian ${atlassian.siteUrl}: Jira ${atlassian.sandbox.jiraProject} and Confluence ${atlassian.sandbox.confluenceSpace} reachable.`,
      );
  }

  const total = estimate(
    tasks,
    models.length,
    variants.length,
    Number(flags.runs),
  );
  say(
    `\nPlanned: ${total.runs} runs, about ${total.modelCalls} model calls (${models.length} model(s) × ${variants.length} variant(s) × ${flags.runs} run(s)).`,
  );
  if (problems.length) {
    say("\nProblems:");
    for (const problem of problems) say(`  - ${problem}`);
    throw new CliError(`${problems.length} problem(s); dry run failed.`);
  }
  say("\nDry run passed. No model calls were made.");
}

/** Fixture round trip without a model: setup, check against an empty answer, cleanup, residue check. */
export async function selftest(
  env: Environment,
  tasks: readonly TaskDefinition[],
): Promise<void> {
  let failed = 0;
  for (const task of tasks) {
    const { ctx, cleanups } = newContext(env, task.id);
    let line = `${task.id}: `;
    try {
      const prompt = await task.setup(ctx);
      const check = await task.check(ctx, { answer: "", toolCalls: [] });
      line += `setup ok (${prompt.length} chars), empty answer ${check.pass ? "PASSED (check is too weak)" : "rejected"}`;
      if (check.pass) failed += 1;
      task.scope(ctx);
    } catch (error) {
      if (error instanceof TaskSkipped) line += `skipped: ${error.message}`;
      else {
        line += `FAILED ${(error as Error).message}`;
        failed += 1;
      }
    }
    const problems = await runCleanups(cleanups);
    const left = await env.atlassian!.searchJql(
      `project = ${env.sandbox.jiraProject} AND labels = "${ctx.tag}"`,
      ["summary"],
    );
    if (problems.length || left.length) {
      failed += 1;
      line += `; CLEANUP: ${[...problems, left.length ? `${left.length} issues left` : ""].filter(Boolean).join("; ")}`;
    } else line += "; cleaned up";
    console.log(line);
  }
  if (failed) throw new CliError(`${failed} selftest problem(s).`);
}
