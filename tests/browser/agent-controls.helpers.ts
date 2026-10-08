import { expect, type Page } from "@playwright/test";

export async function agentDetails(page: Page, name: string) {
  await page.keyboard.press("Escape");
  const context = page
    .getByRole("tab", { name: "Context", exact: true })
    .first();
  if ((await context.getAttribute("aria-selected")) !== "true")
    await context.click();
  const row = page
    .locator(".panel-row")
    .filter({ has: page.getByText(name, { exact: true }) });
  const foldedHistory = page.getByText(/\d+ finished/).first();
  if (!(await row.isVisible()) && (await foldedHistory.isVisible()))
    await foldedHistory.click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Agent details", exact: true }).click();
  return page.locator(".popover-content:visible");
}

export async function agentAction(page: Page, name: string, action: string) {
  const details = await agentDetails(page, name);
  await details.getByRole("button", { name: action, exact: true }).click();
  if (action !== "Agent settings") await page.keyboard.press("Escape");
}

export async function expectAgentAction(
  page: Page,
  name: string,
  action: string,
) {
  const details = await agentDetails(page, name);
  await expect(
    details.getByRole("button", { name: action, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
}

export async function expectAgentDetails(
  page: Page,
  name: string,
  text: string,
  present = true,
) {
  const details = await agentDetails(page, name);
  if (present) await expect(details).toContainText(text);
  else await expect(details).not.toContainText(text);
  await page.keyboard.press("Escape");
}

export async function expectSelectedAgent(page: Page, name: string) {
  const context = page
    .getByRole("tab", { name: "Context", exact: true })
    .first();
  if ((await context.getAttribute("aria-selected")) !== "true")
    await context.click();
  await expect(
    page
      .locator(".panel-row")
      .filter({ has: page.getByText(name, { exact: true }) }),
  ).toHaveClass(/bg-selected/);
}

export async function mobileAgentAction(
  page: Page,
  name: string,
  action: string,
) {
  const heading = page.getByRole("heading", { name: "Context", exact: true });
  if (!(await heading.isVisible()))
    await page
      .getByRole("button", { name: "Conversation context", exact: true })
      .click();
  await page
    .getByRole("button", { name: `Actions for ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: action, exact: true }).click();
  if (action !== "Agent settings") await returnToConversation(page);
}

export async function returnToConversation(page: Page) {
  if (
    await page
      .getByRole("heading", { name: "Context", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
}

import type {
  OperationName,
  OperationParams,
  OperationResult,
} from "@nervekit/contracts/operations";

export async function rpc<M extends OperationName>(
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
      source: {
        role: "ui",
        id: "browser_agent_controls",
        instanceId: "browser_agent_controls_instance",
      },
      target: { role: "workbench_server" },
      data: {
        method,
        params,
        ...(method.startsWith("run.")
          ? { idempotencyKey: crypto.randomUUID() }
          : {}),
      },
    },
  });
  const envelope = await response.json();
  expect(envelope.kind, JSON.stringify(envelope)).toBe("response");
  return envelope.data.result as OperationResult<M>;
}

export async function expectMobileAgentAction(
  page: Page,
  name: string,
  action: string,
) {
  await page
    .getByRole("button", { name: "Conversation context", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Actions for ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: action, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await returnToConversation(page);
}
