import { expect, test, type Page } from "@playwright/test";
import {
  conversationFixture,
  promptEditor,
  coreRpc,
  submit,
} from "./conversation.helpers.js";

async function menu(page: Page, text: string, action: string) {
  await page
    .getByRole("region", { name: "Conversation transcript", exact: true })
    .getByText(text, { exact: true })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

test("editing an earlier prompt creates a branch while retaining durable history", async ({
  page,
}) => {
  const f = await conversationFixture(page);
  try {
    const conversationId = f.snapshot.conversation.id;
    await submit(page, conversationId, "Original browser prompt");
    await f.open("Browser conversation");
    await expect(
      page.getByText("Original browser prompt", { exact: true }).first(),
    ).toBeVisible();
    await menu(page, "Original browser prompt", "Edit message");
    const composer = promptEditor(page);
    await expect(composer).toHaveText("Original browser prompt");
    await composer.fill("Edited browser prompt");
    await composer.press("Enter");
    await expect(
      page.getByText("Edited browser prompt", { exact: true }).first(),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const tree = await coreRpc(page, "conversation.getTree", {
          conversationId,
        });
        return tree.filter((event) => event.type === "assistant_message")
          .length;
      })
      .toBe(2);
    const tree = await coreRpc(page, "conversation.getTree", {
      conversationId,
    });
    expect(tree.filter((node) => node.type === "user_message")).toHaveLength(2);
    await f.open("Browser conversation");
    await expect(
      page.getByText("Edited browser prompt", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Original browser prompt", { exact: true }),
    ).toHaveCount(0);
    await menu(page, "Edited browser prompt", "History");
    const history = page.getByRole("listbox", {
      name: "Conversation history",
    });
    await expect(history).toBeVisible();
    // Both the original and the edited prompt stay in History.
    await expect(history.getByText("Original browser prompt")).toBeVisible();
    await expect(history.getByText("Edited browser prompt")).toBeVisible();
  } finally {
    await f.close();
  }
});

test("selecting a previous head updates the visible path without deleting other events", async ({
  page,
}) => {
  const f = await conversationFixture(page);
  try {
    const conversationId = f.snapshot.conversation.id;
    const history = await submit(page, conversationId, "First branch prompt");
    const previousHead = history.findLast(
      (event) => event.type === "assistant_message",
    )!;
    await submit(page, conversationId, "Later branch prompt");
    await coreRpc(page, "conversation.selectHead", {
      conversationId,
      eventId: previousHead.id,
    });
    await f.open("Browser conversation");
    await expect(
      page.getByText("First branch prompt", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Later branch prompt", { exact: true }),
    ).toHaveCount(0);
    const retained = await coreRpc(page, "conversation.getTree", {
      conversationId,
    });
    expect(
      retained.some(
        (event) =>
          event.type === "user_message" &&
          event.preview.includes("Later branch prompt"),
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
});
