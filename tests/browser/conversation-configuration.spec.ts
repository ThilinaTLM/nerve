import { expect, test } from "@playwright/test";
import { conversationFixture, coreRpc } from "./conversation.helpers.js";

test("composer configuration persists on the conversation across reload", async ({
  page,
}) => {
  const f = await conversationFixture(page);
  try {
    const conversationId = f.snapshot.conversation.id;
    await page
      .getByRole("button", { name: "Agent profile", exact: true })
      .click();
    await page.getByRole("button", { name: "Planning", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await coreRpc(page, "conversation.getSnapshot", { conversationId }))
            .config.agentProfile,
      )
      .toBe("planning");
    await page.reload();
    await expect(page.getByTitle(/Agent profile: Planning/)).toBeVisible();
    await page
      .getByRole("button", { name: "Agent profile", exact: true })
      .click();
    await page.getByRole("button", { name: "Coding", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await coreRpc(page, "conversation.getSnapshot", { conversationId }))
            .config.agentProfile,
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
    const conversationId = f.snapshot.conversation.id;
    await composer.fill("Keep this unsent draft");
    await coreRpc(page, "conversation.configure", {
      conversationId,
      patch: { permissionRuleSetId: "autonomous" },
    });
    await coreRpc(page, "conversation.setAgentProfile", {
      conversationId,
      profile: "planning",
    });
    await expect(page.getByTitle(/Agent profile: Planning/)).toBeVisible();
    const permission = page.getByRole("button", {
      name: "Permission rule set",
      exact: true,
    });
    await expect(permission).toHaveAttribute("title", /Planning/);
    await coreRpc(page, "conversation.setAgentProfile", {
      conversationId,
      profile: "coding",
    });
    await expect(page.getByTitle(/Agent profile: Coding/)).toBeVisible();
    // Coding applies the built-in settings default, not the previous profile's Lock.
    await expect(permission).toHaveAttribute("title", /Autonomous/);
    await expect(composer).toHaveText("Keep this unsent draft");
  } finally {
    await f.close();
  }
});
