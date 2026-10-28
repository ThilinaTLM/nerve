import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentConfigurationService,
  type AgentConfigurationServiceOptions,
} from "./agent-configuration-service.js";
import type { AgentScope } from "./document-adapters.js";
export const A = { provider: "p", modelId: "a" };
export const B = { provider: "q", modelId: "b" };
export const user = { scope: "user" } as const;
export const project = { scope: "project", projectId: "p" } as const;
export const lead = { scope: "conversation", conversationId: "lead" } as const;
export const definition = {
  schemaVersion: 1,
  name: "coding",
  whenToUse: "Coding",
  usableBy: "both",
  instructions: "",
};
export const leadDocument = {
  schemaVersion: 1,
  revision: 0,
  overrides: {},
  appliedProfile: null,
};
export async function put(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}
export async function fixture(
  t: { after(fn: () => Promise<void>): void },
  overrides: Partial<AgentConfigurationServiceOptions> = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-config-service-"));
  t.after(async () => {
    await service.flushSummaries();
    await rm(root, { recursive: true, force: true });
  });
  let ownerReads = 0;
  const options: AgentConfigurationServiceOptions = {
    home: path.join(root, "home"),
    projectDirectory: (id) => path.join(root, "projects", id),
    conversationOwner: (id) => {
      ownerReads += 1;
      return {
        projectId: "p",
        role: id.startsWith("child") ? "child" : "lead",
      };
    },
    builtins: { coding: JSON.stringify(definition) },
    isProfileTrusted: () => false,
    captureResources: () => ({
      options: { referenceAvailable: () => true },
      isCurrent: () => true,
    }),
    ...overrides,
  };
  const service = new AgentConfigurationService(options);
  await put(path.join(options.home, "config", "agent.json"), {
    schemaVersion: 1,
    revision: 0,
    overrides: { model: A },
  });
  await put(
    path.join(
      options.home,
      "data",
      "conversations",
      "lead",
      "config",
      "agent.json",
    ),
    leadDocument,
  );
  return {
    service,
    options,
    ownerReads: () => ownerReads,
    agent: (scope: AgentScope, value: unknown) =>
      put(service.paths.agent(scope), value),
  };
}
export function mutation(
  expectedRevision: number,
  expectedDigest: string,
  changes: object = {},
  resets: string[] = [],
) {
  return { expectedRevision, expectedDigest, changes, resets };
}
