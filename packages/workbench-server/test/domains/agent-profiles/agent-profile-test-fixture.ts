import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";
import type { AgentProfileDiagnostic } from "@nervekit/contracts/agent-profiles";
import {
  AgentProfileService,
  type AgentProfileServiceDeps,
} from "../../../src/domains/agent-profiles/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
export const context = { projectId: "proj_one", conversationId: "conv_one" };
export async function setup(
  availability?: AgentProfileServiceDeps["availability"],
  onConversationRead?: () => void,
) {
  const root = await mkdtemp(join(tmpdir(), "nerve-profiles-"));
  roots.push(root);
  const project = join(root, "project");
  const userPath = join(root, "home", "config", "agent-profiles.json");
  const conversationsPath = join(root, "home", "data", "conversations");
  await mkdir(project);
  const trusted = new Map<string, string>();
  const changes: unknown[] = [];
  let diagnostics: AgentProfileDiagnostic[] = [];
  const service = new AgentProfileService({
    userPath,
    conversationsPath,
    getProject: (id) => {
      if (id !== context.projectId) throw new Error("Unknown project");
      return { id, directory: project };
    },
    getConversation: (id) => {
      onConversationRead?.();
      if (id !== context.conversationId)
        throw new Error("Unknown conversation");
      return { projectId: context.projectId };
    },
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
    availability: availability ?? (async () => diagnostics),
  });
  const projectPath = join(project, ".nerve", "config", "agent-profiles.json");
  const conversationPath = join(
    conversationsPath,
    context.conversationId,
    "config",
    "agent-profiles.json",
  );
  const write = async (path: string, profiles: unknown) => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify({ schemaVersion: 1, profiles }));
  };
  return {
    service,
    root,
    project,
    userPath,
    projectPath,
    conversationPath,
    write,
    changes,
    setDiagnostics: (value: AgentProfileDiagnostic[]) => {
      diagnostics = value;
    },
  };
}
