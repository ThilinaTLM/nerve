import { expect, test } from "@playwright/test";
import {
  conversationFixture,
  effectiveAgent,
  saveAgentSettings,
  setAgentProfile,
} from "./conversation.helpers.js";

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
          (await effectiveAgent(page, conversationId)).appliedProfile?.name,
      )
      .toBe("planning");
    await f.open("Browser conversation");
    await expect(page.getByTitle(/Agent profile: Planning/)).toBeVisible();
    await page
      .getByRole("button", { name: "Agent profile", exact: true })
      .click();
    await page.getByRole("button", { name: "Coding", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await effectiveAgent(page, conversationId)).appliedProfile?.name,
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
    await saveAgentSettings(page, conversationId, {
      permissionRuleSetId: "autonomous",
    });
    await setAgentProfile(page, conversationId, "planning");
    await expect(page.getByTitle(/Agent profile: Planning/)).toBeVisible();
    const permission = page.getByRole("button", {
      name: "Permission rule set",
      exact: true,
    });
    await expect(permission).toHaveAttribute(
      "title",
      /Permission rule set: Draft .*Locked by planning/,
    );
    await setAgentProfile(page, conversationId, "coding");
    await expect(page.getByTitle(/Agent profile: Coding/)).toBeVisible();
    // Leaving Planning removes its requirement and restores the explicit override.
    await expect(permission).toHaveAttribute(
      "title",
      /Permission rule set: Auto \(/,
    );
    expect(
      (await effectiveAgent(page, conversationId)).resolution.settings
        .permissionRuleSetId,
    ).toBe("autonomous");
    await expect(composer).toHaveText("Keep this unsent draft");
  } finally {
    await f.close();
  }
});
