import { expect, test } from "@playwright/test";
import { conversationFixture, coreRpc } from "./conversation.helpers.js";

test("composer configuration persists on the conversation across reload", async ({
  page,
}) => {
  const f = await conversationFixture(page);
  try {
    const conversationId = f.snapshot.conversation.id;
    await page.getByTitle(/Mode: Coding/).click();
    await expect
      .poll(
        async () =>
          (await coreRpc(page, "conversation.getSnapshot", { conversationId }))
            .config.mode,
      )
      .toBe("planning");
    await page.reload();
    await expect(page.getByTitle(/Mode: Planning/)).toBeVisible();
    await page.getByTitle(/Mode: Planning/).click();
    await expect
      .poll(
        async () =>
          (await coreRpc(page, "conversation.getSnapshot", { conversationId }))
            .config.mode,
      )
      .toBe("coding");
  } finally {
    await f.close();
  }
});

test("configuration notices update the open composer without replacing its draft", async ({
  page,
}) => {
  const f = await conversationFixture(page);
  try {
    const composer = page.getByRole("textbox").first();
    await composer.fill("Keep this unsent draft");
    await coreRpc(page, "conversation.configure", {
      conversationId: f.snapshot.conversation.id,
      patch: { mode: "planning", permissionRuleSetId: "autonomous" },
    });
    await expect(page.getByTitle(/Mode: Planning/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Permission rule set", exact: true }),
    ).toHaveAttribute("title", /Planning/);
    await coreRpc(page, "conversation.configure", {
      conversationId: f.snapshot.conversation.id,
      patch: { mode: "coding" },
    });
    await expect(
      page.getByRole("button", { name: "Permission rule set", exact: true }),
    ).toHaveAttribute("title", /Autonomous/);
    await expect(composer).toHaveText("Keep this unsent draft");
  } finally {
    await f.close();
  }
});
