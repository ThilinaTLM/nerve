import { expect, test } from "@playwright/test";
import { coreRpc } from "./conversation.helpers.js";

test("Kroki settings validate, cancel, persist and toggle independently", async ({
  page,
}) => {
  await page.goto("/settings");
  const toolsPage = page
    .getByRole("complementary", { name: "Settings pages" })
    .getByRole("button", { name: "Tools", exact: true });
  await toolsPage.click();
  const enabled = page.getByRole("switch", {
    name: "Enable Diagram export",
    exact: true,
  });
  const configure = page.getByRole("button", {
    name: "Configure diagram export",
  });
  await expect(enabled).not.toBeChecked();
  await expect(
    page.getByText("Off · kroki.io/", { exact: true }),
  ).toBeVisible();
  await configure.click();
  let dialog = page.getByRole("dialog", { name: "Configure diagram export" });
  await expect(
    dialog.getByRole("textbox", { name: "Kroki server" }),
  ).toHaveValue("https://kroki.io/");
  await dialog
    .getByRole("textbox", { name: "Kroki server" })
    .fill("file:///tmp/kroki");
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await configure.click();
  dialog = page.getByRole("dialog", { name: "Configure diagram export" });
  await expect(
    dialog.getByRole("textbox", { name: "Kroki server" }),
  ).toHaveValue("https://kroki.io/");
  await dialog
    .getByRole("textbox", { name: "Kroki server" })
    .fill("http://127.0.0.1:9080/kroki");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Off · 127.0.0.1:9080/kroki/", { exact: true }),
  ).toBeVisible();
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect
    .poll(async () => {
      const configuration = await coreRpc(page, "agentConfiguration.get", {
        scope: { scope: "user" },
      });
      return configuration.status === "available"
        ? configuration.overrides.tools?.kroki_export
        : null;
    })
    .toMatchObject({
      enabled: true,
      settings: { url: "http://127.0.0.1:9080/kroki/" },
    });
  await page.reload();
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await toolsPage.click();
  await expect(enabled).toBeChecked();
  await configure.click();
  dialog = page.getByRole("dialog", { name: "Configure diagram export" });
  await expect(
    dialog.getByRole("textbox", { name: "Kroki server" }),
  ).toHaveValue("http://127.0.0.1:9080/kroki/");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
});
