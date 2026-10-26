import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ToolCall } from "@nervekit/contracts/core";
import { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { ConfigurationDiagnostic } from "../infrastructure/configuration/agent-configuration/document-adapters.js";
import {
  createConfigurationReload,
  resolveWithConfigurationRetry,
} from "./configuration-reload.js";

const diagnostic: ConfigurationDiagnostic = {
  scope: "user",
  document: "agent",
  path: "ignored-client-path",
  code: "malformed-json",
  pointer: "",
  affectedCapability: "tool-execution",
  recoveryChoices: ["retry", "reload"],
};
void test("explicit Retry reloads invalid agent dependencies and the exact published policy scopes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-reload-"));
  await mkdir(join(home, "config"));
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => home,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: {},
    isProfileTrusted: () => true,
    captureResources: () => ({ options: {}, isCurrent: () => true }),
  });
  t.after(async () => {
    await service.flushSummaries();
    await rm(home, { recursive: true, force: true });
  });
  const file = service.paths.agent({ scope: "user" });
  await writeFile(file, "bad");
  assert.equal(
    (await service.ensureLoaded({ scope: "user" })).status,
    "unavailable",
  );
  await writeFile(
    file,
    JSON.stringify({ schemaVersion: 1, revision: 1, overrides: {} }),
  );
  assert.equal(
    (await service.ensureLoaded({ scope: "user" })).status,
    "unavailable",
  );
  const paths: (readonly string[] | undefined)[] = [];
  const reload = createConfigurationReload(service, {
    reload: async (value) => {
      paths.push(value);
    },
  });
  await reload.retry("c", [
    diagnostic,
    {
      ...diagnostic,
      document: "permissions.json",
      path: "/not-a-reload-target",
    },
  ]);
  assert.equal((await service.ensureLoaded({ scope: "user" })).status, "ready");
  assert.deepEqual(paths, [[join(home, "config", "permissions.json")]]);
});

void test("configuration-blocked Retry refreshes before resolving, Cancel does not, and observer retries do not dispatch twice", async () => {
  let pending: ToolCall | undefined = {
    id: "call",
    conversationId: "c",
    interaction: {
      kind: "configuration_blocked",
      request: { diagnostics: [diagnostic] },
    },
  } as ToolCall;
  const order: string[] = [];
  const ports = {
    lookup: () => pending,
    reload: async () => {
      order.push("reload");
    },
    resolve: async () => {
      order.push("resolve");
      return { status: "resolved" as const };
    },
  };
  const input = {
    toolCallId: "call",
    resolutionRequestId: "r",
    resolution: {
      kind: "configuration_blocked" as const,
      decision: "retry" as const,
    },
  };
  await resolveWithConfigurationRetry(input, ports);
  assert.deepEqual(order.splice(0), ["reload", "resolve"]);
  await resolveWithConfigurationRetry(
    {
      ...input,
      resolution: { kind: "configuration_blocked", decision: "cancel" },
    },
    ports,
  );
  assert.deepEqual(order.splice(0), ["resolve"]);
  ports.reload = async () => {
    order.push("reload");
    pending = undefined;
  };
  assert.deepEqual(await resolveWithConfigurationRetry(input, ports), {
    status: "resolved",
  });
  assert.deepEqual(order, ["reload"]);
});
