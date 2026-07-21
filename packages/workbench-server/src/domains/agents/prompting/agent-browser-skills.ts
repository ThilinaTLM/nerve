import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AvailableSkill } from "@nervekit/contracts";
import {
  loadSkills,
  NodeExecutionEnv,
  type Skill,
  validateDescription,
  validateName,
} from "@nervekit/host-runtime/harness";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 15_000;
const commandMaxBuffer = 4 * 1024 * 1024;

export interface AgentBrowserCommandRunner {
  run(args: readonly string[]): Promise<string>;
}

class NodeAgentBrowserCommandRunner implements AgentBrowserCommandRunner {
  async run(args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("agent-browser", [...args], {
      timeout: commandTimeoutMs,
      maxBuffer: commandMaxBuffer,
      encoding: "utf8",
    });
    return stdout;
  }
}

interface AgentBrowserSkillSummary {
  name: string;
  description: string;
}

export class AgentBrowserSkillCatalog {
  #skills: Skill[] = [];
  #tempRoot?: string;
  #initialized = false;

  constructor(
    private readonly commandRunner: AgentBrowserCommandRunner = new NodeAgentBrowserCommandRunner(),
  ) {}

  get skills(): readonly Skill[] {
    return this.#skills;
  }

  get availableSkills(): AvailableSkill[] {
    return this.#skills.map(({ name, description, filePath }) => ({
      name,
      description,
      filePath,
    }));
  }

  get tempRoot(): string | undefined {
    return this.#tempRoot;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;

    let summaries: AgentBrowserSkillSummary[];
    try {
      summaries = parseSkillSummaries(
        await this.commandRunner.run(["skills", "--json"]),
      );
    } catch (error) {
      if (isExecutableMissing(error)) return;
      throw error;
    }
    if (summaries.length === 0) return;

    const tempRoot = await mkdtemp(
      join(tmpdir(), "nerve-agent-browser-skills-"),
    );
    this.#tempRoot = tempRoot;
    try {
      const stageResults = await Promise.allSettled(
        summaries.map(async ({ name }) => {
          const content = await this.commandRunner.run([
            "skills",
            "get",
            name,
            "--full",
          ]);
          const skillDir = join(tempRoot, name);
          await mkdir(skillDir);
          await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
        }),
      );
      const failedStage = stageResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failedStage) throw failedStage.reason;

      const loaded = await loadSkills(
        new NodeExecutionEnv({ cwd: tempRoot }),
        tempRoot,
      );
      const byName = new Map(loaded.skills.map((skill) => [skill.name, skill]));
      const missing = summaries
        .map(({ name }) => name)
        .filter((name) => !byName.has(name));
      if (loaded.diagnostics.length > 0 || missing.length > 0) {
        const details = [
          ...loaded.diagnostics.map(
            (diagnostic) => `${diagnostic.path}: ${diagnostic.message}`,
          ),
          ...missing.map((name) => `missing staged skill: ${name}`),
        ];
        throw new Error(
          `Could not load staged Agent Browser skills: ${details.join("; ")}`,
        );
      }
      this.#skills = summaries.map(({ name }) => byName.get(name)!);
    } catch (error) {
      await this.#removeTempRoot();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.#skills = [];
    await this.#removeTempRoot();
  }

  async #removeTempRoot(): Promise<void> {
    const tempRoot = this.#tempRoot;
    this.#tempRoot = undefined;
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseSkillSummaries(output: string): AgentBrowserSkillSummary[] {
  const parsed = JSON.parse(output) as unknown;
  if (!parsed || typeof parsed !== "object" || !("data" in parsed)) {
    throw new Error("Invalid Agent Browser skill catalog response");
  }
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Invalid Agent Browser skill catalog data");
  }

  const summaries = data.map((value): AgentBrowserSkillSummary => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid Agent Browser skill catalog entry");
    }
    const { name, description } = value as Record<string, unknown>;
    if (typeof name !== "string" || validateName(name, name).length > 0) {
      throw new Error(`Invalid Agent Browser skill name: ${String(name)}`);
    }
    if (
      typeof description !== "string" ||
      validateDescription(description).length > 0
    ) {
      throw new Error(`Invalid Agent Browser skill description: ${name}`);
    }
    return { name, description };
  });

  if (new Set(summaries.map(({ name }) => name)).size !== summaries.length) {
    throw new Error("Duplicate Agent Browser skill names");
  }
  return summaries;
}

function isExecutableMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
