import { expect, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type {
  OperationName,
  OperationParams,
  OperationResult,
} from "../../packages/contracts/src/operations/index.js";
import { basename, join } from "node:path";
import type { z } from "zod";
import {
  coreOperationSchemas,
  type CoreOperationName,
} from "../../packages/contracts/src/domains/core/core-operations.js";

/** Use the public conversation channel, with the browser's authenticated cookie. */
export async function coreRpc<M extends CoreOperationName>(
  page: Page,
  method: M,
  params: z.input<(typeof coreOperationSchemas)[M]["params"]>,
): Promise<z.output<(typeof coreOperationSchemas)[M]["result"]>> {
  const result = await page.evaluate(
    ({ method, params }) =>
      new Promise<unknown>((resolve, reject) => {
        const url = new URL("/ws/conversations", location.href);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(url);
        const source = {
          role: "ui",
          id: "browser_conversations",
          instanceId: crypto.randomUUID(),
        };
        const requestId = `msg_${crypto.randomUUID()}`;
        const timer = setTimeout(
          () => finish(new Error(`Timed out: ${method}`)),
          10_000,
        );
        let settled = false;
        function finish(error?: Error, value?: unknown) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.close();
          if (error) reject(error);
          else resolve(value);
        }
        function send(
          kind: string,
          data: unknown,
          target = { role: "workbench_server" },
        ) {
          socket.send(
            JSON.stringify({
              protocol: "nerve",
              version: 1,
              id: kind === "request" ? requestId : `msg_${crypto.randomUUID()}`,
              kind,
              ts: new Date().toISOString(),
              source,
              target,
              data,
            }),
          );
        }
        socket.onopen = () =>
          send("hello", {
            requestedVersion: 1,
            capabilities: [
              "encoding.json",
              "event.notify",
              "stream.subscription.v1",
              `operation.${method}`,
            ],
            requiredCapabilities: [
              "stream.subscription.v1",
              `operation.${method}`,
            ],
            encodings: ["json"],
          });
        socket.onerror = () =>
          finish(new Error(`Conversation socket failed: ${method}`));
        socket.onclose = ({ code, reason }) =>
          finish(
            new Error(
              `Conversation socket closed: ${method} (${code}: ${reason})`,
            ),
          );
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(data);
          if (message.kind === "welcome") {
            send(
              "ready",
              { sessionId: message.data.sessionId },
              message.data.acceptingPeer,
            );
            send("request", { method, params }, message.data.acceptingPeer);
          } else if (message.kind === "error")
            finish(new Error(JSON.stringify(message.data)));
          else if (message.kind === "response" && message.replyTo === requestId)
            finish(undefined, message.data.result);
        };
      }),
    { method, params },
  );
  return coreOperationSchemas[method].result.parse(result) as z.output<
    (typeof coreOperationSchemas)[M]["result"]
  >;
}

async function workbenchRpc<M extends OperationName>(
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
      source: { role: "ui", id: "browser_conversations" },
      target: { role: "workbench_server" },
      data: { method, params },
    },
  });
  const envelope = await response.json();
  expect(envelope.kind, JSON.stringify(envelope)).toBe("response");
  return envelope.data.result;
}

export async function conversationFixture(page: Page) {
  // A tiny real provider keeps composer/model-picker behavior on the public path.
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { model } = JSON.parse(body);
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta: unknown, finishReason: string | null) =>
      `data: ${JSON.stringify({ id: "browser-completion", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
    response.end(
      chunk(
        { role: "assistant", content: "Browser assistant response" },
        null,
      ) +
        chunk({}, "stop") +
        "data: [DONE]\n\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing provider address");
  const provider = `browser-conversations-${crypto.randomUUID()}`;
  const closeProvider = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  const directory = await mkdtemp(join(tmpdir(), "nerve-conversation-ui-"));
  const projectId = `proj_${crypto.randomUUID()}`;
  try {
    await page.goto("/");
    await workbenchRpc(page, "providerCatalog.custom.upsert", {
      id: provider,
      displayName: "Browser provider",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      headers: {},
    });
    await workbenchRpc(page, "providerCatalog.model.upsert", {
      provider,
      modelId: "browser",
      name: "Browser model",
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
    const project = await coreRpc(page, "project.create", {
      id: projectId,
      name: basename(directory),
      directory,
    });
    const createConversation = (title: string, parentConversationId?: string) =>
      coreRpc(page, "conversation.create", {
        id: `conv_${crypto.randomUUID()}`,
        projectId: project.id,
        parentConversationId,
        title,
        config: {
          model: { provider, modelId: "browser" },
          reasoningLevel: "off",
          systemPrompt: null,
          permissionRuleSetId: "read_only",
          mode: "coding",
          workingDirectory: directory,
        },
      });
    const snapshot = await createConversation("Browser conversation");
    const open = async (title: string) => {
      await page.reload();
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await page
          .getByRole("button", {
            name: new RegExp(`^${title} ${project.name}`),
          })
          .click();
      } else {
        await page
          .getByRole("navigation", { name: "Projects", exact: true })
          .getByRole("button", { name: new RegExp(project.name) })
          .click();
        await page.getByText(title, { exact: true }).first().click();
      }
      await expect(page.getByRole("textbox").first()).toBeVisible();
    };
    await open(snapshot.conversation.title);
    return {
      project,
      snapshot,
      createConversation,
      open,
      close: async () => {
        try {
          await coreRpc(page, "project.delete", { projectId });
          await workbenchRpc(page, "providerCatalog.custom.delete", {
            id: provider,
          });
        } finally {
          await closeProvider();
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await coreRpc(page, "project.delete", { projectId }).catch(() => undefined);
    await closeProvider();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function submit(page: Page, conversationId: string, text: string) {
  await coreRpc(page, "input.submit", {
    conversationId,
    inputId: `input_${crypto.randomUUID()}`,
    source: "user",
    text,
  });
  await expect
    .poll(async () => {
      const history = await coreRpc(page, "conversation.getHistory", {
        conversationId,
        limit: 100,
      });
      const user = history.findLast(
        (event) =>
          event.type === "user_message" && event.payload.originalText === text,
      );
      return (
        user !== undefined &&
        history.some(
          (event) =>
            event.type === "assistant_message" &&
            event.sequence > user.sequence,
        )
      );
    })
    .toBe(true);
  await expect
    .poll(
      async () =>
        (await coreRpc(page, "conversation.getSnapshot", { conversationId }))
          .conversation.status,
    )
    .toBe("idle");
  const history = await coreRpc(page, "conversation.getHistory", {
    conversationId,
    limit: 100,
  });
  expect(history.some((event) => event.type === "assistant_message")).toBe(
    true,
  );
  return history;
}
