import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { rpc } from "./agent-controls.helpers.js";

// Uses playwright.config's non-reusable /tmp/nerve-browser-test-* launcher.
// Never target a live daemon or inject/repair stored user model history.
async function fixture(page: Page) {
  const dir = await mkdtemp(join(tmpdir(), "nerve-browser-branch-project-"));
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const chunk of request) {
      void chunk;
    }
    const tool = ++requests === 1;
    if (requests === 3) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "Isolated branch status fixture failure",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
    const delta = tool
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "branch_ls",
              type: "function",
              function: {
                name: "ls",
                arguments: JSON.stringify({ path: "." }),
              },
            },
          ],
        }
      : { role: "assistant", content: "Verified branch assistant response" };
    const chunk = (delta: unknown, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-branch", object: "chat.completion.chunk", created: 0, model: "branch", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      chunk(delta, null) +
        chunk({}, tool ? "tool_calls" : "stop") +
        "data: [DONE]\n\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture provider port");
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    expect(["43967", "43968"]).not.toContain(new URL(page.url()).port);
    const provider = `browser-branch-${crypto.randomUUID()}`;
    await rpc(page, "providerCatalog.custom.upsert", {
      id: provider,
      displayName: "Branch fixture",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      headers: {},
    });
    await rpc(page, "providerCatalog.model.upsert", {
      provider,
      modelId: "branch",
      name: "Branch fixture",
      reasoning: false,
      supportedThinkingLevels: ["off"],
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    });
    expect(
      (
        await page.request.put("/api/provider-keys", {
          data: { provider, apiKey: "isolated-loopback-placeholder" },
        })
      ).ok(),
    ).toBe(true);
    const { project } = await rpc(page, "project.create", { dir });
    const { conversation } = await rpc(page, "conversation.create", {
      projectId: project.id,
      title: "Model-aware branch fixture",
    });
    const { agent } = await rpc(page, "agent.create", {
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider, modelId: "branch" },
      thinkingLevel: "off",
      permissionLevel: "autonomous",
      permissionRuleSetId: "autonomous",
      tools: ["ls"],
    });
    await rpc(page, "run.start", {
      agentId: agent.id,
      text: "Original model-aware browser prompt",
      idempotencyKey: crypto.randomUUID(),
    });
    await expect
      .poll(
        async () =>
          (await rpc(page, "agent.history.get", { agentId: agent.id }))
            .latestCompletion?.outcome,
      )
      .toBe("completed");
    const firstCompletion = (
      await rpc(page, "agent.history.get", { agentId: agent.id })
    ).latestCompletion!;
    // Produce a real transcript-only failure notice, not a fabricated tree row.
    // run.start can acknowledge acceptance without a run ID. Its exact persisted
    // user-input entry supplies the binding; a previous completion is not proof
    // that this request failed, and a recoverable interruption is still active.
    const failedPrompt = "Produce an isolated failed-run notice";
    const accepted = await rpc(page, "run.start", {
      agentId: agent.id,
      text: failedPrompt,
      idempotencyKey: crypto.randomUUID(),
    });
    let failedRunId: string | undefined;
    await expect
      .poll(async () => {
        const history = await rpc(page, "agent.history.get", {
          agentId: agent.id,
        });
        const inputs = history.entries.filter(
          (entry) => entry.role === "user" && entry.text === failedPrompt,
        );
        const runId = inputs.length === 1 ? inputs[0]?.runId : undefined;
        if (
          !runId ||
          runId === firstCompletion.runId ||
          (accepted.runId && accepted.runId !== runId)
        )
          return "awaiting requested run binding";
        failedRunId = runId;
        if (history.activeRun?.runId === runId) return history.activeRun.status;
        if (history.latestCompletion?.runId === runId)
          return history.latestCompletion.outcome;
        return "awaiting requested run outcome";
      })
      .toBe("interrupted");
    const interrupted = await rpc(page, "agent.history.get", {
      agentId: agent.id,
    });
    expect(interrupted.activeRun).toMatchObject({
      runId: failedRunId,
      status: "interrupted",
    });
    // Owner history does not populate the optional recovery projection. Prove
    // the provider fault through its real, run-correlated persisted notice.
    await expect
      .poll(async () => {
        const history = await rpc(page, "agent.history.get", {
          agentId: agent.id,
        });
        return history.entries.find(
          (entry) => entry.kind === "run_status" && entry.runId === failedRunId,
        );
      })
      .toMatchObject({
        agentId: agent.id,
        conversationId: conversation.id,
        runId: failedRunId,
        text: expect.stringMatching(
          /^400:.*Isolated branch status fixture failure/,
        ),
        details: {
          state: "retry_exhausted",
          runId: failedRunId,
          failureCategory: "provider",
          retryable: true,
        },
      });
    expect(requests).toBe(3);
    // Only stop after proving the real failed checkpoint. Never resume it or
    // dispatch another attempt to make the fixture's terminal polling succeed.
    await rpc(page, "agent.stop", { agentId: agent.id });
    await expect
      .poll(async () => {
        const history = await rpc(page, "agent.history.get", {
          agentId: agent.id,
        });
        return !history.activeRun &&
          history.latestCompletion?.runId === failedRunId
          ? history.latestCompletion.outcome
          : "awaiting requested run settlement";
      })
      .toMatch(/^(cancelled|failed|interrupted)$/);
    expect(requests).toBe(3);
    const { snapshot } = await rpc(page, "snapshot.conversation.get", {
      conversationId: conversation.id,
    });
    await page.reload();
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: new RegExp(basename(dir)) })
      .click();
    // The real first input updates the conversation title; use the current
    // canonical snapshot, not the stale create response's placeholder title.
    await page
      .getByRole("region", { name: "Left Panel", exact: true })
      .getByText(snapshot.conversation.title, { exact: true })
      .click();
    await expect(
      page
        .getByText("Verified branch assistant response", { exact: true })
        .first(),
    ).toBeVisible();
    return { conversation, agent, snapshot, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function menu(page: Page, text: string, action: string) {
  await page
    .getByRole("region", { name: "Conversation transcript", exact: true })
    .getByText(text, { exact: true })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  // Portal exit motion can leave the previous menu accessible briefly. Wait
  // for teardown rather than accidentally selecting a different card's item.
  await expect(page.getByRole("menu")).toHaveCount(0);
}

async function expandGraph(page: Page) {
  const expand = page.getByRole("button", {
    name: "Expand all tool runs",
    exact: true,
  });
  if (await expand.isVisible()) await expand.click();
}

test("transcript menus and graph use model capabilities; failed edit preserves draft and successful root edit fills it", async ({
  page,
}) => {
  const f = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const navigations: Array<string | null> = [];
  let failEdit = false;
  await page.route("**/api/protocol/v1", async (route) => {
    const request = route.request().postDataJSON();
    if (request?.data?.method === "conversation.navigate") {
      navigations.push(request.data.params.activeEntryId);
      if (failEdit) {
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  try {
    const user = f.snapshot.tree.nodes.find(
      (node) => node.entry.role === "user",
    )!;
    const assistant = f.snapshot.tree.nodes.find(
      (node) => node.entry.text === "Verified branch assistant response",
    )!;
    const result = f.snapshot.tree.nodes.find(
      (node) =>
        node.entry.kind === "tool_result" && node.navigation.continueTarget,
    )!;
    const status = f.snapshot.tree.nodes.find(
      (node) => node.entry.kind === "run_status",
    )!;
    expect(user.navigation.editTarget).toEqual({ activeEntryId: null });
    expect(status.navigation).toEqual({
      continueTarget: null,
      editTarget: null,
    });
    expect(result).toBeTruthy();
    await menu(page, assistant.entry.text, "Continue from here");
    await expect
      .poll(() => navigations.at(-1))
      .toBe(assistant.navigation.continueTarget!.activeEntryId);

    // Exercise the actual settled transcript tool card, not just its graph.
    // message-mirror persists the toolRecordId on the result; timeline keeps
    // the card stable while promoting that exact result association as anchor.
    const settledTool = f.snapshot.toolCalls.find(
      (tool) => tool.toolName === "ls" && tool.status === "completed",
    )!;
    expect(settledTool).toBeTruthy();
    expect(result.entry.details).toMatchObject({
      toolRecordId: settledTool.id,
    });
    const requestNode = f.snapshot.tree.nodes.find(
      (node) =>
        node.entry.role === "assistant" &&
        (node.entry.details as { toolCallId?: string } | undefined)
          ?.toolCallId ===
          (settledTool.providerToolCallId ?? settledTool.sourceToolCallId),
    )!;
    expect(requestNode).toBeTruthy();
    expect(result.navigation.continueTarget!.activeEntryId).not.toBe(
      requestNode.navigation.continueTarget?.activeEntryId,
    );
    const beforeToolNavigation = navigations.length;
    await page
      .getByRole("region", { name: "Conversation transcript", exact: true })
      .getByRole("button", { name: "View ls details", exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Continue from here", exact: true })
      .click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(() => navigations.length).toBe(beforeToolNavigation + 1);
    expect(navigations.at(-1)).toBe(
      result.navigation.continueTarget!.activeEntryId,
    );
    const afterTool = await rpc(page, "snapshot.conversation.get", {
      conversationId: f.conversation.id,
    });
    expect(afterTool.snapshot.tree.navigation.activeModelEntryId).toBe(
      result.navigation.continueTarget!.activeEntryId,
    );
    expect(afterTool.snapshot.tree.navigation.contextState).toBe("valid");

    await menu(page, user.entry.text, "Branch history");
    await expandGraph(page);
    const statusNode = page.locator(
      `[data-id="history-entry:${status.entry.id}"]`,
    );
    await statusNode.click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Branch from here", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    const resultNode = page.locator(
      `[data-id="history-entry:${result.entry.id}"]`,
    );
    // Completed request/result cards can share one visible graph node. This
    // chooses the displayed card only; the expected model target comes from
    // the server's result capability, never from this transcript parent.
    const displayedResult = (await resultNode.count())
      ? resultNode
      : page.locator(`[data-id="history-entry:${result.entry.parentEntryId}"]`);
    await displayedResult.dblclick();
    await expect
      .poll(() => navigations.at(-1))
      .toBe(result.navigation.continueTarget!.activeEntryId);
    await expect(
      page.getByRole("dialog", { name: "Conversation history" }),
    ).toBeHidden();

    const composer = page
      .locator(".composer-wrap")
      .getByRole("textbox")
      .first();
    await composer.fill("KEEP_EXISTING_DRAFT");
    failEdit = true;
    await menu(page, user.entry.text, "Edit message");
    await expect(
      page.getByText("Could not branch conversation", { exact: true }).first(),
    ).toBeVisible();
    await expect(composer).toHaveText("KEEP_EXISTING_DRAFT");
    failEdit = false;
    await menu(page, user.entry.text, "Edit message");
    await expect(composer).toHaveText(user.entry.text);
    expect(navigations.at(-1)).toBe(user.navigation.editTarget!.activeEntryId);
    const repaired = await rpc(page, "snapshot.conversation.get", {
      conversationId: f.conversation.id,
    });
    expect(repaired.snapshot.tree.navigation.activeModelEntryId).toBeNull();
    expect(repaired.snapshot.tree.navigation.contextState).toBe("valid");
    expect(errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("history/queue rejection preserves canonical display and stale queued input, gates execution, and keeps navigation/discard usable", async ({
  page,
}) => {
  const f = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let rejectEnrichment = false;
  await page.route("**/api/protocol/v1", async (route) => {
    const request = route.request().postDataJSON();
    if (
      rejectEnrichment &&
      ["agent.history.get", "agent.promptQueue.list"].includes(
        request?.data?.method,
      )
    ) {
      await route.fulfill({
        status: 409,
        contentType: "application/vnd.nerve.protocol.v1+json",
        json: {
          ...request,
          id: `msg_error_${crypto.randomUUID()}`,
          kind: "error",
          replyTo: request.id,
          source: request.target,
          target: request.source,
          data: {
            code: "DOMAIN_VALIDATION_FAILED",
            message:
              request.data.method === "agent.history.get"
                ? "Owner history leaf/ancestor is missing from its model tree"
                : "Queue fixture is unavailable",
            retryable: false,
          },
        },
      });
      return;
    }
    await route.continue();
  });
  try {
    await rpc(page, "agent.stop", { agentId: f.agent.id });
    await rpc(page, "run.start", {
      agentId: f.agent.id,
      text: "Durable pending browser assignment",
      idempotencyKey: crypto.randomUUID(),
    });
    await page.reload();
    const queued = page.getByRole("article", { name: "Queued user prompt" });
    await expect(queued).toContainText("Durable pending browser assignment");
    rejectEnrichment = true;
    await menu(
      page,
      "Verified branch assistant response",
      "Continue from here",
    );
    const staleHint = queued.getByText("Last known queue", { exact: true });
    await expect(staleHint).toBeVisible();
    await expect(staleHint).toHaveAttribute(
      "title",
      /Showing the last known queue/,
    );
    await expect(page.locator(".composer-wrap").getByRole("alert")).toHaveCount(
      0,
    );
    await expect(page.locator('.composer-wrap [data-slot="card"]')).toHaveCount(
      0,
    );
    await expect(
      page
        .getByRole("region", { name: "Conversation transcript", exact: true })
        .getByText("Original model-aware browser prompt", { exact: true })
        .first(),
    ).toBeVisible();
    await expect(queued).toContainText("Durable pending browser assignment");
    const composer = page
      .locator(".composer-wrap")
      .getByRole("textbox")
      .first();
    await composer.fill("BLOCKED_DRAFT");
    await expect(
      page.getByRole("button", { name: "Send prompt", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Send prompt", exact: true }),
    ).toHaveAttribute(
      "title",
      /Sending is unavailable:.*Owner history leaf\/ancestor/,
    );
    await expect(
      page.getByRole("button", {
        name: "Force push all queued prompts",
        exact: true,
      }),
    ).toBeDisabled();
    await queued
      .getByRole("button", { name: "Discard queued prompt", exact: true })
      .click();
    await expect(queued).toHaveCount(0);
    rejectEnrichment = false;
    await menu(
      page,
      "Verified branch assistant response",
      "Continue from here",
    );
    await expect(page.locator(".composer-wrap").getByRole("alert")).toHaveCount(
      0,
    );
    await expect(page.locator('.composer-wrap [data-slot="card"]')).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Last known queue", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Send prompt", exact: true }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await f.close();
  }
});
