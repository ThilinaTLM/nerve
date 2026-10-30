import { NodeAgentBrowserCommandRunner } from "../../../../core-host/agent-browser-skills.js";
import { validateName } from "@nervekit/harness/resources";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@nervekit/harness/resources";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import type { ConversionContext, Data } from "./released-format.js";

/** Home migration only discovers user-owned skills, never project/ancestor roots. */
export async function discoverReleasedHomeSkillSources(
  home: string,
  inputs: Data[],
): Promise<ConversionContext["skillSources"]> {
  const userAgents = join(homedir(), ".agents/skills");
  const env = new NodeExecutionEnv({ cwd: home });
  const loaded = await loadSkills(env, [
    join(home, "agent/skills"),
    userAgents,
  ]);
  if (loaded.diagnostics.length)
    throw new Error(
      `Released skill discovery failed: ${loaded.diagnostics.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
    );
  return classifyReleasedSkills(
    [
      ...loaded.skills.map((skill) => ({
        name: skill.name,
        source: "file" as const,
      })),
      ...(await browserNames()).map((name) => ({
        name,
        source: "agentBrowser" as const,
      })),
    ],
    inputs,
  );
}
export function classifyReleasedSkills(
  discovered: readonly {
    name: string;
    source: "file" | "nerve" | "agentBrowser";
  }[],
  inputs: Data[],
): ConversionContext["skillSources"] {
  const result = Object.create(null) as Record<
    string,
    ("file" | "nerve" | "agentBrowser")[]
  >;
  const add = (name: string, source: "file" | "nerve" | "agentBrowser") => {
    const list = (result[name] ??= []);
    if (!list.includes(source)) list.push(source);
  };
  for (const item of discovered) add(item.name, item.source);
  for (const name of ["planning", "team-lead", "skill-creator"])
    add(name, "nerve");
  for (const input of inputs) {
    for (const source of ["file", "nerve", "agentBrowser"] as const)
      for (const name of Object.keys(
        input.capabilities?.skills?.[source] ?? {},
      ))
        add(name, source);
    for (const name of input.harness?.skills?.disabled ?? []) add(name, "file");
    for (const source of ["nerve", "agentBrowser"] as const)
      for (const name of input.harness?.skills?.[source]?.enabled ?? [])
        add(name, source);
  }
  return result;
}

let browserDiscovery: Promise<string[]> | undefined;
async function browserNames(): Promise<string[]> {
  browserDiscovery ??= (async () => {
    let bytes: string;
    try {
      bytes = await new NodeAgentBrowserCommandRunner().run([
        "skills",
        "--json",
      ]);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return [];
      throw new Error("Released Agent Browser skill discovery unavailable", {
        cause: error,
      });
    }
    const raw = JSON.parse(bytes) as { data?: { name?: unknown }[] };
    if (!Array.isArray(raw.data))
      throw new Error("Invalid released Agent Browser skill catalog");
    const names = raw.data.map((entry) => {
      if (
        typeof entry.name !== "string" ||
        validateName(entry.name, entry.name).length
      )
        throw new Error("Invalid released Agent Browser skill identity");
      return entry.name;
    });
    if (new Set(names).size !== names.length)
      throw new Error("Duplicate Agent Browser skill identities");
    return names;
  })().catch((error: unknown) => {
    browserDiscovery = undefined;
    throw error;
  });
  return browserDiscovery;
}
