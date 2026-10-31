import { expect, test } from "@playwright/test";
import {
  conversationFixture,
  promptEditor,
  coreRpc,
  setAgentProfile,
  submit,
} from "./conversation.helpers.js";

for (const width of [1440, 390]) {
  test(`conversation composer sends input and restores history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = await conversationFixture(page);
    try {
      const prompt = `Browser prompt ${width}`;
      const composer = promptEditor(page);
      await composer.fill(prompt);
      await composer.press("Enter");
      await expect(
        page.getByText(prompt, { exact: true }).first(),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const history = await coreRpc(page, "conversation.getHistory", {
            conversationId: f.snapshot.conversation.id,
            limit: 100,
          });
          return history.some((event) => event.type === "assistant_message");
        })
        .toBe(true);
      await f.open("Browser conversation");
      await expect(
        page.getByText(prompt, { exact: true }).first(),
      ).toBeVisible();
      await expect(promptEditor(page).locator(".cm-placeholder")).toBeVisible();
    } finally {
      await f.close();
    }
  });
}

test("separate conversations keep private history and configuration", async ({
  page,
}) => {
  const f = await conversationFixture(page);
  try {
    const other = await f.createConversation("Other conversation");
    await submit(page, f.snapshot.conversation.id, "First private prompt");
    await submit(page, other.conversation.id, "Second private prompt");
    await setAgentProfile(page, other.conversation.id, "planning");
    await f.open("Other conversation");
    await expect(
      page.getByText("Second private prompt", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("First private prompt", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTitle(/Agent profile: Planning/)).toBeVisible();
    await f.open("Browser conversation");
    await expect(
      page.getByText("First private prompt", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Second private prompt", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTitle(/Agent profile: Coding/)).toBeVisible();
  } finally {
    await f.close();
  }
});
