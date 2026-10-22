import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "node:test";
import { AgentProfileService } from "../../../src/domains/agent-profiles/index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
export const context = { projectId: "proj_one", conversationId: "conv_one" };
export async function setup() {
  const root = await mkdtemp(join(tmpdir(), "nerve-profile-files-"));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(project);
  const userPath = join(root, "home/data/agent-profiles");
  const trusted = new Map<string, string>();
  const changes: unknown[] = [];
  const service = new AgentProfileService({
    userPath,
    getProject: (id) => {
      if (id !== context.projectId) throw new Error("Unknown project");
      return { id, directory: project };
    },
    getConversation: () => ({ projectId: context.projectId }),
    trust: {
      isTrusted: (_kind, _project, path, digest) =>
        trusted.get(path) === digest,
      decide: (input) => {
        trusted.set(input.path, input.contentDigest);
        return input as never;
      },
    },
    events: {
      publish: async (_type, change) => {
        changes.push(change);
      },
    },
  });
  const file = (name: string, scope: "user" | "project" = "user") =>
    join(
      scope === "user" ? userPath : join(project, ".nerve/agent-profiles"),
      `${name}.json`,
    );
  const write = async (
    name: string,
    entry: object,
    scope: "user" | "project" = "user",
  ) => {
    const path = file(name, scope);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        name,
        description: "Template",
        usableBy: "subagent",
        instructions: "",
        ...entry,
      }),
    );
  };
  return { root, project, service, file, write, changes };
}
