import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  operationDefinition,
  type OperationName,
  type OperationParams,
  type OperationResult,
} from "../../packages/contracts/src/operations/index.js";

async function rpc<M extends OperationName>(
  page: Page,
  method: M,
  params: OperationParams<M>,
): Promise<OperationResult<M>> {
  const response = await page.request.post("/api/protocol/v1", {
    headers: { "content-type": "application/vnd.nerve.protocol.v1+json" },
    data: {
      protocol: "nerve",
      version: 1,
      id: `msg_${crypto.randomUUID()}`,
      kind: "request",
      ts: new Date().toISOString(),
      source: {
        role: "ui",
        id: "browser_live_configuration",
        instanceId: "browser_live_configuration_instance",
      },
      target: { role: "workbench_server" },
      data: {
        method,
        params,
        ...(operationDefinition(method).idempotency !== "none"
          ? { idempotencyKey: crypto.randomUUID() }
          : {}),
      },
    },
  });
  const envelope = await response.json();
  expect(envelope.kind, JSON.stringify(envelope)).toBe("response");
  return envelope.data.result as OperationResult<M>;
}

type ProviderRequest = {
  model: string;
  messages: Array<{ role: string; content?: unknown }>;
};

// A real local OpenAI-compatible endpoint, not a route-mocked model listing.
// Hold the first child invocation so browser edits deterministically land while
// its original configuration is in flight. Its response requests a real read;
// only after that tool settles may the next model receive queued steering.
async function providerFixture(parentPrompt: string, assignment: string) {
  const childRequests: ProviderRequest[] = [];
  let held: { response: ServerResponse; model: string } | undefined;
  let parentInvocations = 0;
  let released = false;
  const completion = (
    response: ServerResponse,
    model: string,
    result: { text: string } | { tool: string; args: unknown },
  ) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const tool = "tool" in result;
    const delta = tool
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${crypto.randomUUID().replaceAll("-", "")}`,
              type: "function",
              function: {
                name: result.tool,
                arguments: JSON.stringify(result.args),
              },
            },
          ],
        }
      : { role: "assistant", content: result.text };
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({
        id: "chatcmpl-browser-live",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    response.end(
      chunk(delta, null) +
        chunk({}, tool ? "tool_calls" : "stop") +
        "data: [DONE]\n\n",
    );
  };
  const release = () => {
    released = true;
    if (held && !held.response.destroyed) {
      completion(held.response, held.model, {
        tool: "read",
        args: { path: "fixture.txt" },
      });
      held = undefined;
    }
  };
  const server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body) as ProviderRequest;
      const firstUser = JSON.stringify(
        payload.messages.find((message) => message.role === "user")?.content,
      );
      if (firstUser?.includes(parentPrompt)) {
        parentInvocations++;
        completion(
          response,
          payload.model,
          parentInvocations === 1
            ? {
                tool: "explore",
                args: {
                  context:
                    "Initial lookup located fixture.txt in this workspace; a fresh read-only child should verify its contents independently.",
                  tasks: [
                    {
                      task: `${assignment}: read fixture.txt and summarize its contents.`,
                      label: "Live Explore evidence",
                    },
                  ],
                },
              }
            : { text: "Parent received the exact Explore report." },
        );
      } else if (firstUser?.includes(assignment)) {
        childRequests.push(payload);
        if (childRequests.length === 1 && !released) {
          held = { response, model: payload.model };
        } else {
          completion(response, payload.model, {
            text: "Live child adopted the next model and steering.",
          });
        }
      } else {
        completion(response, payload.model, {
          text: "Live configuration fixture",
        });
      }
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing mock endpoint port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    childRequests,
    parentInvocations: () => parentInvocations,
    release,
    close: async () => {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

for (const preset of ["developer", "explore"] as const) {
  test(`${preset} adopts a real next-turn model and queued steering during a live assignment${preset === "explore" ? " while the Explore wrapper waits" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const dir = await mkdtemp(join(tmpdir(), "nerve-live-configuration-"));
    const provider = `browser-live-${crypto.randomUUID().slice(0, 8)}`;
    const parentPrompt = `PARENT_EXPLORE_${provider}`;
    const assignment = `LIVE_CHILD_ASSIGNMENT_${provider}`;
    const steering = `NEXT_TURN_STEERING_${provider}`;
    const endpoint = await providerFixture(parentPrompt, assignment);
    let rootId: string | undefined;
    let childId: string | undefined;
    try {
      await writeFile(
        join(dir, "fixture.txt"),
        "ORIGINAL_TOOL_RESULT_BEFORE_NEXT_REQUEST\n",
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/");
      await rpc(page, "providerCatalog.custom.upsert", {
        id: provider,
        displayName: "Live browser endpoint",
        api: "openai-completions",
        baseUrl: endpoint.baseUrl,
        headers: {},
      });
      for (const modelId of ["original", "replacement"]) {
        await rpc(page, "providerCatalog.model.upsert", {
          provider,
          modelId,
          name: `${provider} ${modelId}`,
          reasoning: false,
          supportedThinkingLevels: ["off"],
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 4096,
        });
      }
      // Non-secret placeholder for this test-owned loopback endpoint only.
      const key = await page.request.put("/api/provider-keys", {
        data: { provider, apiKey: "browser-loopback-placeholder" },
      });
      expect(key.ok()).toBe(true);
      const { project } = await rpc(page, "project.create", { dir });
      const { conversation } = await rpc(page, "conversation.create", {
        projectId: project.id,
        title: `Live ${preset} configuration`,
      });
      const { agent: root } = await rpc(page, "agent.create", {
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider, modelId: "original" },
        thinkingLevel: "off",
        permissionLevel: "autonomous",
        permissionRuleSetId: "autonomous",
        tools: ["explore"],
      });
      rootId = root.id;
      if (preset === "developer") {
        const { agent: child } = await rpc(page, "agent.create", {
          projectId: project.id,
          conversationId: conversation.id,
          parentAgentId: root.id,
          name: "Live developer evidence",
          model: { provider, modelId: "original" },
          thinkingLevel: "off",
          permissionLevel: "read_only",
          permissionRuleSetId: "read_only",
          tools: ["read"],
          orchestrationPolicy: {
            preset,
            parentCancellation: "independent",
            completionReporting: "none",
          },
        });
        childId = child.id;
      }
      await page.reload();
      await page
        .getByRole("navigation", { name: "Projects", exact: true })
        .getByRole("button", { name: new RegExp(basename(dir)) })
        .click();
      await page.getByText(conversation.title, { exact: true }).first().click();
      if (preset === "explore") {
        // This child is created by the actual orchestration tool, not seeded with
        // an Explore label. The parent remains blocked awaiting its exact run.
        await rpc(page, "run.start", { agentId: root.id, text: parentPrompt });
      } else {
        await rpc(page, "run.start", { agentId: childId!, text: assignment });
      }
      await expect.poll(() => endpoint.childRequests.length).toBe(1);
      if (preset === "explore") {
        await expect
          .poll(async () => {
            const { agents } = await rpc(page, "agent.list", {});
            childId = agents.find(
              (agent) =>
                agent.parentAgentId === root.id &&
                agent.name === "Live Explore evidence",
            )?.id;
            return childId;
          })
          .toBeTruthy();
        expect(
          (await rpc(page, "agent.get", { agentId: childId! })).agent
            .readOnlyCeiling,
        ).toBe(true);
        expect(endpoint.parentInvocations()).toBe(1);
        expect(
          (await rpc(page, "agent.history.get", { agentId: root.id }))
            .latestCompletion,
        ).toBeNull();
      }
      const originalHistory = await rpc(page, "agent.history.get", {
        agentId: childId!,
      });
      expect(originalHistory.activeRun?.runId).toBeTruthy();
      expect(endpoint.childRequests[0]!.model).toBe("original");
      expect(
        originalHistory.effectiveConfiguration?.configurationProvenance,
      ).toBe("resolved");
      expect(
        originalHistory.effectiveConfiguration?.configuration.model,
      ).toEqual({ provider, modelId: "original" });
      const originalRevision =
        originalHistory.effectiveConfiguration!.configurationRevision;
      if (preset === "explore") {
        await page
          .getByRole("button", {
            name: "Open agent Live Explore evidence",
            exact: true,
          })
          .click();
      } else {
        await page
          .getByRole("tab", { name: "Context", exact: true })
          .first()
          .click();
        await page
          .getByText("Live developer evidence", { exact: true })
          .first()
          .click();
      }
      const controls = page.getByLabel("Agent controls", { exact: true });
      await expect(controls).toContainText(
        preset === "explore"
          ? "Live Explore evidence"
          : "Live developer evidence",
      );
      await page
        .getByRole("button", { name: "Model and thinking level", exact: true })
        .click();
      await page.getByText(`${provider} replacement`, { exact: true }).click();
      await page.keyboard.press("Escape");
      await expect
        .poll(
          async () =>
            (await rpc(page, "agent.get", { agentId: childId! })).agent.model
              ?.modelId,
        )
        .toBe("replacement");
      await expect(controls).toContainText("Pending next turn");
      const composer = page.getByRole("textbox").first();
      await composer.fill(steering);
      await composer.press("Enter");
      await expect(controls).toContainText("pending input");
      await expect
        .poll(async () =>
          (
            await rpc(page, "agent.promptQueue.list", { agentId: childId! })
          ).queuedPrompts.map((input) => input.text),
        )
        .toContain(steering);
      const pendingHistory = await rpc(page, "agent.history.get", {
        agentId: childId!,
      });
      expect(pendingHistory.activeRun?.runId).toBe(
        originalHistory.activeRun!.runId,
      );
      expect(pendingHistory.effectiveConfiguration?.configurationRevision).toBe(
        originalRevision,
      );
      expect(endpoint.childRequests).toHaveLength(1);
      expect(
        (await rpc(page, "agent.get", { agentId: root.id })).agent.model
          ?.modelId,
      ).toBe("original");
      endpoint.release();
      await expect.poll(() => endpoint.childRequests.length).toBe(2);
      const nextRequest = endpoint.childRequests[1]!;
      expect(nextRequest.model).toBe("replacement");
      const payload = JSON.stringify(nextRequest.messages);
      expect(payload.split(steering)).toHaveLength(2);
      expect(payload).toContain("ORIGINAL_TOOL_RESULT_BEFORE_NEXT_REQUEST");
      const toolResultIndex = nextRequest.messages.findIndex(
        (message) =>
          message.role === "tool" &&
          JSON.stringify(message.content).includes(
            "ORIGINAL_TOOL_RESULT_BEFORE_NEXT_REQUEST",
          ),
      );
      const steeringIndex = nextRequest.messages.findIndex(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes(steering),
      );
      expect(toolResultIndex).toBeGreaterThanOrEqual(0);
      expect(steeringIndex).toBeGreaterThan(toolResultIndex);
      expect(
        nextRequest.messages.some((message) => message.role === "tool"),
      ).toBe(true);
      await expect
        .poll(
          async () =>
            (await rpc(page, "agent.history.get", { agentId: childId! }))
              .latestCompletion?.outcome,
        )
        .toBe("completed");
      const completed = await rpc(page, "agent.history.get", {
        agentId: childId!,
      });
      expect(completed.latestCompletion?.runId).toBe(
        originalHistory.activeRun!.runId,
      );
      expect(completed.effectiveConfiguration?.configuration.model).toEqual({
        provider,
        modelId: "replacement",
      });
      expect(
        completed.effectiveConfiguration!.configurationRevision,
      ).toBeGreaterThan(originalRevision);
      expect(completed.effectiveConfiguration!.configurationRevision).toBe(
        (await rpc(page, "agent.get", { agentId: childId! })).agent
          .configurationRevision,
      );
      expect(
        completed.entries.filter(
          (entry) => entry.role === "user" && entry.text === steering,
        ),
      ).toHaveLength(1);
      await expect(controls).not.toContainText("pending input");
      await expect(controls).not.toContainText("Pending next turn");
      if (preset === "explore") {
        await expect
          .poll(
            async () =>
              (await rpc(page, "agent.history.get", { agentId: root.id }))
                .latestCompletion?.outcome,
          )
          .toBe("completed");
        expect(endpoint.parentInvocations()).toBe(2);
        const parentHistory = await rpc(page, "agent.history.get", {
          agentId: root.id,
        });
        expect(
          parentHistory.entries.some(
            (entry) => entry.role === "user" && entry.text === steering,
          ),
        ).toBe(false);
      }
    } finally {
      endpoint.release();
      for (const agentId of [childId, rootId]) {
        if (agentId) await rpc(page, "agent.stop", { agentId });
      }
      await endpoint.close();
      await page.request.delete(`/api/provider-keys/${provider}`);
      await rpc(page, "providerCatalog.custom.delete", { id: provider });
      await rm(dir, { recursive: true, force: true });
    }
  });
}
