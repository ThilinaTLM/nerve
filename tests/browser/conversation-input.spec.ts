import { expect, test } from "@playwright/test";
import { conversationFixture, coreRpc } from "./conversation.helpers.js";

test("non-waking input stays queued, can be discarded, and force-pushes into durable history", async ({
  page,
}) => {
  const f = await conversationFixture(page);
  try {
    const conversationId = f.snapshot.conversation.id;
    await coreRpc(page, "conversation.pause", { conversationId });
    const inputId = `input_${crypto.randomUUID()}`;
    await coreRpc(page, "input.submit", {
      conversationId,
      inputId,
      text: "Discard this queued prompt",
      source: "user",
      wakeWhenIdle: false,
    });
    await expect(
      page.getByText("Discard this queued prompt", { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByText("Discard this queued prompt", { exact: true })
      .first()
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Discard", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await coreRpc(page, "conversation.getSnapshot", { conversationId }))
            .queue,
      )
      .toEqual([]);
    await expect(
      page.getByText("Discard this queued prompt", { exact: true }),
    ).toHaveCount(0);
    const nextId = `input_${crypto.randomUUID()}`;
    const input = {
      conversationId,
      inputId: nextId,
      text: "Resume this queued prompt",
      source: "user" as const,
      wakeWhenIdle: false,
    };
    await coreRpc(page, "input.submit", input);
    await coreRpc(page, "input.submit", input);
    expect(
      (
        await coreRpc(page, "conversation.getSnapshot", { conversationId })
      ).queue.map((item) => item.inputId),
    ).toEqual([nextId]);
    await page
      .getByText(input.text, { exact: true })
      .first()
      .click({ button: "right" });
    await page
      .getByRole("menuitem", {
        name: "Force push all queued prompts",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        const history = await coreRpc(page, "conversation.getHistory", {
          conversationId,
          limit: 100,
        });
        return history.some((event) => event.type === "assistant_message");
      })
      .toBe(true);
    const history = await coreRpc(page, "conversation.getHistory", {
      conversationId,
      limit: 100,
    });
    expect(
      history.filter(
        (event) =>
          event.type === "user_message" &&
          event.payload.originalText === input.text,
      ),
    ).toHaveLength(1);
    expect(
      (await coreRpc(page, "conversation.getSnapshot", { conversationId }))
        .queue,
    ).toEqual([]);
    await page.reload();
    await expect(
      page.getByText(input.text, { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});
