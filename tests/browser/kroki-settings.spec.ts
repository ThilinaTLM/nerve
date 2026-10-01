import { expect, test } from "@playwright/test";

test("Kroki settings validate, cancel, persist and toggle independently", async ({
  page,
}) => {
  await page.goto("/settings");
  const toolsPage = page
    .getByRole("complementary", { name: "Settings pages" })
    .getByRole("button", { name: "Tools", exact: true });
  await toolsPage.click();
  const enabled = page.getByRole("switch", {
    name: "Enable Diagram export (Kroki) tools",
  });
  const configure = page.getByRole("button", {
    name: "Configure diagram export",
  });
  await expect(enabled).not.toBeChecked();
  await configure.click();
  let dialog = page.getByRole("dialog", { name: "Configure diagram export" });
  await expect(dialog.getByRole("textbox", { name: "Kroki URL" })).toHaveValue(
    "https://kroki.io/",
  );
  await dialog
    .getByRole("textbox", { name: "Kroki URL" })
    .fill("file:///tmp/kroki");
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await configure.click();
  dialog = page.getByRole("dialog", { name: "Configure diagram export" });
  await expect(dialog.getByRole("textbox", { name: "Kroki URL" })).toHaveValue(
    "https://kroki.io/",
  );
  await dialog
    .getByRole("textbox", { name: "Kroki URL" })
    .fill("http://127.0.0.1:9080/kroki");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await toolsPage.click();
  await expect(enabled).toBeChecked();
  await configure.click();
  dialog = page.getByRole("dialog", { name: "Configure diagram export" });
  await expect(dialog.getByRole("textbox", { name: "Kroki URL" })).toHaveValue(
    "http://127.0.0.1:9080/kroki/",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
});
