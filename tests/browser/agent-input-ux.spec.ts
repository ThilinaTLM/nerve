import { expect, test } from "@playwright/test";
import { rpc } from "./agent-controls.helpers.js";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

test("expanded prompts and force-push retain interrupted tools through ordinary conversation UI", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-browser-input-ux-"));
  const requests: Array<{
    messages: Array<{ role: string; content?: unknown }>;
  }> = [];
  let finish!: () => void;
  const respond = (response: ServerResponse, tool: boolean) => {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const delta = tool
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "slow_browser_call",
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: "sleep 30", timeout: 60 }),
              },
            },
          ],
        }
      : { role: "assistant", content: "Browser follow-up received" };
    const chunk = (delta: unknown, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-input-ux", object: "chat.completion.chunk", created: 0, model: "ux", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    response.end(
      chunk(delta, null) +
        chunk({}, tool ? "tool_calls" : "stop") +
        "data: [DONE]\n\n",
    );
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (requests.length === 1) respond(response, true);
    else finish = () => respond(response, false);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing provider port");
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    const provider = `browser-input-ux-${crypto.randomUUID()}`;
    await rpc(page, "providerCatalog.custom.upsert", {
      id: provider,
      displayName: "Input UX fixture",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      headers: {},
    });
    await rpc(page, "providerCatalog.model.upsert", {
      provider,
      modelId: "ux",
      name: "Input UX",
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
          data: { provider, apiKey: "browser-loopback-placeholder" },
        })
      ).ok(),
    ).toBe(true);
    const { project } = await rpc(page, "project.create", { dir });
    const { conversation } = await rpc(page, "conversation.create", {
      projectId: project.id,
      title: "Input UX regression",
    });
    const { agent } = await rpc(page, "agent.create", {
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider, modelId: "ux" },
      thinkingLevel: "off",
      permissionLevel: "autonomous",
      permissionRuleSetId: "autonomous",
      tools: ["bash"],
    });
    await page.reload();
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: new RegExp(basename(dir)) })
      .click();
    await page.getByText(conversation.title, { exact: true }).first().click();
    const composer = page.getByRole("textbox").first();
    await composer.fill(
      "Initial browser prompt\n```!!!\nprintf BROWSER_BLOCK_OUTPUT\n```",
    );
    await composer.press("Enter");
    await expect.poll(() => requests.length).toBe(1);
    expect(JSON.stringify(requests[0])).toContain("status: completed");
    expect(JSON.stringify(requests[0])).not.toContain("```!!!");
    await expect(page.locator(".conversation-pane")).toContainText(
      "BROWSER_BLOCK_OUTPUT",
    );
    await expect
      .poll(async () =>
        (
          await rpc(page, "agent.history.get", { agentId: agent.id })
        ).toolCalls.some((tool) => tool.status === "running"),
      )
      .toBe(true);
    await composer.fill("Urgent browser follow-up");
    await composer.press("Enter");
    const pending = page.getByRole("article", { name: "Queued user prompt" });
    await expect(pending).toContainText("Queued for next turn");
    await page.reload();
    await expect(pending).toContainText("Urgent browser follow-up");
    const runId = (await rpc(page, "agent.history.get", { agentId: agent.id }))
      .activeRun!.runId;
    await page
      .getByRole("button", {
        name: "Force push all queued prompts",
        exact: true,
      })
      .click();
    await expect.poll(() => requests.length).toBe(2);
    expect(JSON.stringify(requests[1])).toContain("Urgent browser follow-up");
    expect(JSON.stringify(requests[1])).toMatch(/abort|cancel|interrupt/i);
    await expect(pending).toHaveCount(0);
    finish();
    await expect
      .poll(
        async () =>
          (await rpc(page, "agent.history.get", { agentId: agent.id }))
            .latestCompletion?.runId,
      )
      .toBe(runId);
    await expect(
      page.getByText("Browser follow-up received", { exact: true }),
    ).toBeVisible();
    const history = await rpc(page, "agent.history.get", { agentId: agent.id });
    expect(
      history.entries.filter(
        (entry) => entry.text === "Urgent browser follow-up",
      ),
    ).toHaveLength(1);
    expect(history.entries.some((entry) => entry.kind === "tool_result")).toBe(
      true,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390)
        await page
          .getByRole("button", {
            name: new RegExp(`Initial browser prompt ${basename(dir)}`),
          })
          .click();
      const pane = page.locator(".conversation-pane");
      await expect(pane.locator(".composer-wrap")).toBeVisible();
      await expect(
        pane.locator(".transcript [aria-label='Conversation transcript']"),
      ).toBeVisible();
      const layout = await pane.evaluate((element) => {
        const transcript = element
          .querySelector(".transcript")!
          .getBoundingClientRect();
        const composer = element
          .querySelector(".composer-wrap")!
          .getBoundingClientRect();
        return {
          top: transcript.top,
          paneTop: element.getBoundingClientRect().top,
          bottom: transcript.bottom,
          composerTop: composer.top,
        };
      });
      expect(Math.abs(layout.top - layout.paneTop)).toBeLessThan(2);
      expect(Math.abs(layout.bottom - layout.composerTop)).toBeLessThan(2);
    }
  } finally {
    finish?.();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
