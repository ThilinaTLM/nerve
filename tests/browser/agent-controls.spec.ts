import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  OperationName,
  OperationParams,
  OperationResult,
} from "@nervekit/contracts/operations";

async function rpc<M extends OperationName>(
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

test("ordinary controls select and administer developer and Explore identities sharing a conversation", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-agent-ui-"));
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await expect(page).toHaveTitle(/nerve/i);
    const { project } = await rpc(page, "project.create", { dir });
    const { conversation } = await rpc(page, "conversation.create", {
      projectId: project.id,
      title: "Shared agent workspace",
    });
    const base = {
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: "nerve-faux", modelId: "faux-fast" },
      permissionLevel: "read_only" as const,
      permissionRuleSetId: "read_only",
    };
    const { agent: root } = await rpc(page, "agent.create", base);
    const { agent: developer } = await rpc(page, "agent.create", {
      ...base,
      parentAgentId: root.id,
      name: "Developer fixture",
      orchestrationPolicy: {
        preset: "developer",
        parentCancellation: "independent",
        completionReporting: "none",
      },
    });
    const { agent: explorer } = await rpc(page, "agent.create", {
      ...base,
      parentAgentId: root.id,
      name: "Explore fixture",
      readOnlyCeiling: true,
      orchestrationPolicy: {
        preset: "explore",
        parentCancellation: "attached",
        completionReporting: "none",
      },
    });
    for (const agent of [root, developer, explorer]) {
      await rpc(page, "run.start", {
        agentId: agent.id,
        text: `Private history ${agent.id}`,
      });
      await expect
        .poll(
          async () => {
            const history = await rpc(page, "agent.history.get", {
              agentId: agent.id,
            });
            return {
              outcome: history.latestCompletion?.outcome,
              hasAssistant: history.entries.some(
                (entry) => entry.role === "assistant",
              ),
            };
          },
          { message: `Initial ordinary run completes for ${agent.id}` },
        )
        .toEqual({ outcome: "completed", hasAssistant: true });
      const history = await rpc(page, "agent.history.get", {
        agentId: agent.id,
      });
      expect(history.effectiveConfiguration?.configurationProvenance).toBe(
        "resolved",
      );
    }
    const currentTitle = (
      await rpc(page, "conversation.get", { conversationId: conversation.id })
    ).conversation.title;
    await page.reload();
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: new RegExp(basename(dir)) })
      .click();
    await page.getByText(currentTitle, { exact: true }).first().click();
    const composer = page.getByRole("textbox").first();
    const controls = page.getByLabel("Agent controls", { exact: true });
    const privateHistory = (id: string) =>
      page.getByText(`Private history ${id}`, { exact: true });
    await expect(controls).toContainText("Lead agent");
    await expect(privateHistory(root.id)).toBeVisible();
    // Context is the normal discovery surface, including completed Explore history.
    await page
      .getByRole("tab", { name: "Context", exact: true })
      .first()
      .click();
    for (const child of [developer, explorer]) {
      if (child.id === explorer.id)
        await page
          .getByText(/1 finished/)
          .first()
          .click();
      await page.getByText(child.name!, { exact: true }).first().click();
      await expect(controls).toContainText(child.name!);
      await expect(privateHistory(child.id)).toBeVisible();
      await expect(privateHistory(root.id)).toHaveCount(0);
      const sibling = child.id === developer.id ? explorer : developer;
      await expect(privateHistory(sibling.id)).toHaveCount(0);
      await controls.getByRole("button", { name: "Pause agent" }).click();
      await expect(
        controls.getByRole("button", { name: "Resume agent" }),
      ).toBeVisible();
      await composer.fill(`Queued follow-up ${child.id}`);
      await composer.press("Enter");
      await expect(controls).toContainText("pending input");
      await controls.getByRole("button", { name: "Agent settings" }).click();
      await page
        .getByRole("textbox", { name: "Instructions", exact: true })
        .fill(`Next-turn instructions ${child.id}`);
      await page.getByRole("button", { name: "Save agent settings" }).click();
      await expect(controls).toContainText("Pending next turn");
      await expect
        .poll(
          async () =>
            (await rpc(page, "agent.get", { agentId: child.id })).agent
              .instructions,
        )
        .toBe(`Next-turn instructions ${child.id}`);
      await controls.getByRole("button", { name: "Resume agent" }).click();
      await expect(
        page.getByText(`Queued follow-up ${child.id}`, { exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const agent = (await rpc(page, "agent.get", { agentId: child.id }))
            .agent;
          return (
            agent.effectiveConfigurationRevision === agent.configurationRevision
          );
        })
        .toBe(true);
      await expect(controls).not.toContainText("pending input");
    }
    await page.getByText("Lead agent", { exact: true }).last().click();
    await expect(controls).toContainText("Lead agent");
    const history = await rpc(page, "agent.history.get", { agentId: root.id });
    const text = `Private history ${root.id}`;
    const original = history.entries.find((entry) => entry.text === text);
    expect(original).toMatchObject({ agentId: root.id, role: "user" });
    expect(history.activeEntryIds).toContain(original?.id);
    const view = page.getByRole("region", { name: "Conversation transcript" });
    await view.hover();
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, -100_000);
        return view.evaluate((el) => ({
          top: el.scrollTop,
          first:
            el.querySelector<HTMLElement>('[data-index="0"]')?.dataset.itemKey,
        }));
      })
      .toEqual({ top: 0, first: `string:"${original?.id}"` });
    await expect(privateHistory(root.id)).toBeVisible();
    await expect(
      page.getByText(`Queued follow-up ${developer.id}`, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("idle children use the full composer, preserve separate drafts, and accept configuration and pause controls", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-idle-agent-ui-"));
  try {
    // Deterministic catalog-only fixture: controls and persistence remain real.
    await page.route("**/api/protocol/v1", async (route) => {
      const request = route.request().postDataJSON();
      if (request?.data?.method !== "model.list") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const envelope = await response.json();
      const faux = envelope.data.result.models.find(
        (model: { provider: string }) => model.provider === "nerve-faux",
      );
      envelope.data.result.models.push({
        ...faux,
        modelId: "faux-ui-alternate",
        name: "UI alternate faux",
      });
      await route.fulfill({ response, json: envelope });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    const { project } = await rpc(page, "project.create", { dir });
    const { conversation } = await rpc(page, "conversation.create", {
      projectId: project.id,
      title: "Idle agent controls",
    });
    const base = {
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: "nerve-faux", modelId: "faux-fast" },
      permissionLevel: "read_only" as const,
      permissionRuleSetId: "read_only",
    };
    const { agent: root } = await rpc(page, "agent.create", base);
    const children = [];
    for (const preset of ["developer", "explore"] as const) {
      children.push(
        (
          await rpc(page, "agent.create", {
            ...base,
            parentAgentId: root.id,
            name: `Idle ${preset}`,
            orchestrationPolicy: {
              preset,
              parentCancellation: "independent",
              completionReporting: "none",
            },
          })
        ).agent,
      );
    }
    await page.reload();
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: new RegExp(basename(dir)) })
      .click();
    await page
      .getByText("Idle agent controls", { exact: true })
      .first()
      .click();
    await page.getByRole("tab", { name: "Context", exact: true }).click();
    const composer = page.getByRole("textbox").first();
    await composer.fill("Unsent root draft");
    for (const child of children) {
      if (child.orchestrationPolicy?.preset === "explore")
        await page
          .getByText(/1 finished/)
          .first()
          .click();
      await page.getByText(child.name!, { exact: true }).first().click();
      const controls = page.getByLabel("Agent controls", { exact: true });
      await expect(controls).toContainText(child.name!);
      await expect(composer).not.toContainText("Unsent root draft");
      await composer.fill(`Unsent ${child.id}`);
      await page
        .getByRole("button", { name: "Model and thinking level", exact: true })
        .click();
      await page.getByText("UI alternate faux", { exact: true }).click();
      await page.keyboard.press("Escape");
      await expect
        .poll(
          async () =>
            (await rpc(page, "agent.get", { agentId: child.id })).agent.model
              ?.modelId,
        )
        .toBe("faux-ui-alternate");
      expect(
        (await rpc(page, "agent.get", { agentId: root.id })).agent.model
          ?.modelId,
      ).toBe("faux-fast");
      await page
        .getByRole("button", { name: "Tools and skills", exact: true })
        .click();
      await page
        .getByRole("switch", {
          name: "Enable Explore for this agent",
          exact: true,
        })
        .click();
      await expect
        .poll(async () =>
          (
            await rpc(page, "agent.get", { agentId: child.id })
          ).agent.tools?.includes("explore"),
        )
        .toBe(false);
      expect(
        (await rpc(page, "agent.get", { agentId: root.id })).agent.tools,
      ).toBeNull();
      await page.keyboard.press("Escape");
      await controls.getByRole("button", { name: "Pause agent" }).click();
      await expect(
        controls.getByRole("button", { name: "Resume agent" }),
      ).toBeVisible();
      expect(
        (await rpc(page, "agent.get", { agentId: child.id })).agent
          .activationState,
      ).toBe("paused");
      await controls.getByRole("button", { name: "Agent settings" }).click();
      await page
        .getByRole("textbox", { name: "Instructions", exact: true })
        .fill(`Instructions for ${child.id}`);
      await page.getByRole("button", { name: "Save agent settings" }).click();
      await expect
        .poll(
          async () =>
            (await rpc(page, "agent.get", { agentId: child.id })).agent
              .instructions,
        )
        .toBe(`Instructions for ${child.id}`);
      await expect(controls).toContainText("Pending next turn");
      await controls.getByRole("button", { name: "Resume agent" }).click();
      await expect(
        controls.getByRole("button", { name: "Pause agent" }),
      ).toBeVisible();
    }
    await page.getByText("Lead agent", { exact: true }).last().click();
    await expect(composer).toHaveText("Unsent root draft");
    for (const child of children) {
      await page.getByText(child.name!, { exact: true }).first().click();
      await expect(composer).toHaveText(`Unsent ${child.id}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("root and child palettes isolate configuration and preserve inherited skills and queue identities", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-agent-inheritance-ui-"));
  try {
    for (const name of ["ui-first-skill", "ui-second-skill"]) {
      const skillDir = join(dir, ".nerve", "skills", name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: Browser inheritance fixture\n---\nRead-only fixture instructions.\n`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    const { project } = await rpc(page, "project.create", { dir });
    const { conversation } = await rpc(page, "conversation.create", {
      projectId: project.id,
      title: "Inherited agent settings",
    });
    const base = {
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: "nerve-faux", modelId: "faux-fast" },
      permissionLevel: "read_only" as const,
      permissionRuleSetId: "read_only",
      skills: null,
    };
    const { agent: root } = await rpc(page, "agent.create", base);
    const { agent: child } = await rpc(page, "agent.create", {
      ...base,
      parentAgentId: root.id,
      name: "Inheritance child",
      orchestrationPolicy: {
        preset: "developer",
        parentCancellation: "independent",
        completionReporting: "none",
      },
    });
    await rpc(page, "agent.stop", { agentId: root.id });
    await rpc(page, "agent.stop", { agentId: child.id });
    await page.reload();
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: new RegExp(basename(dir)) })
      .click();
    await page
      .getByText("Inherited agent settings", { exact: true })
      .first()
      .click();
    const controls = page.getByLabel("Agent controls", { exact: true });
    await controls.getByRole("button", { name: "Agent settings" }).click();
    await expect(
      page.getByRole("switch", { name: "Inherit resource skills" }),
    ).toBeChecked();
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Only instructions changed");
    await page.getByRole("button", { name: "Save agent settings" }).click();
    await expect
      .poll(
        async () =>
          (await rpc(page, "agent.get", { agentId: root.id })).agent
            .instructions,
      )
      .toBe("Only instructions changed");
    expect(
      (await rpc(page, "agent.get", { agentId: root.id })).agent.skills,
    ).toBeNull();
    await controls.getByRole("button", { name: "Agent settings" }).click();
    await page.getByRole("switch", { name: "Use registered tools" }).uncheck();
    await page.getByRole("button", { name: "Save agent settings" }).click();
    await expect
      .poll(
        async () =>
          (await rpc(page, "agent.get", { agentId: root.id })).agent.tools,
      )
      .toEqual([]);
    await page
      .getByRole("button", { name: "Tools and skills", exact: true })
      .click();
    await expect(
      page.getByRole("switch", {
        name: "Enable Explore for this agent",
        exact: true,
      }),
    ).not.toBeChecked();
    await page
      .getByRole("switch", {
        name: "Enable Explore for this agent",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await rpc(page, "agent.get", { agentId: root.id })).agent.tools,
      )
      .toEqual(["explore"]);
    await page.getByRole("radio", { name: /^Skills/ }).click();
    const first = page.getByRole("switch", {
      name: "Enable ui-first-skill for this agent",
      exact: true,
    });
    const second = page.getByRole("switch", {
      name: "Enable ui-second-skill for this agent",
      exact: true,
    });
    await expect(first).toBeChecked();
    await expect(second).toBeChecked();
    await first.click();
    await expect
      .poll(
        async () =>
          (await rpc(page, "agent.get", { agentId: root.id })).agent.skills,
      )
      .toContain("ui-second-skill");
    await expect(first).not.toBeChecked();
    await expect(second).toBeChecked();
    await page.keyboard.press("Escape");
    expect(
      (await rpc(page, "agent.get", { agentId: child.id })).agent.skills,
    ).toBeNull();
    expect(
      (await rpc(page, "agent.get", { agentId: child.id })).agent.tools,
    ).toBeNull();
    await page.getByRole("tab", { name: "Context", exact: true }).click();
    await page.getByText("Inheritance child", { exact: true }).first().click();
    await page
      .getByRole("button", { name: "Tools and skills", exact: true })
      .click();
    await page.getByRole("radio", { name: /^Tools/ }).click();
    await expect(
      page.getByRole("switch", {
        name: "Enable Explore for this agent",
        exact: true,
      }),
    ).toBeChecked();
    await page.getByRole("radio", { name: /^Skills/ }).click();
    await expect(first).toBeChecked();
    await expect(second).toBeChecked();
    await page.keyboard.press("Escape");
    await controls.getByRole("button", { name: "Agent settings" }).click();
    await page
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Child instruction edit");
    await page.getByRole("button", { name: "Save agent settings" }).click();
    await expect
      .poll(
        async () =>
          (await rpc(page, "agent.get", { agentId: child.id })).agent
            .instructions,
      )
      .toBe("Child instruction edit");
    expect(
      (await rpc(page, "agent.get", { agentId: child.id })).agent.skills,
    ).toBeNull();
    // A remotely accepted idle/paused next-run item has no run event. The
    // selected pane's bounded queue refresh must discover and cancel its RAW ID.
    const remoteInput = {
      agentId: child.id,
      text: "Remote next-run input",
      idempotencyKey: "browser-stable-follow-up",
    };
    await rpc(page, "run.followUp", remoteInput);
    await rpc(page, "run.followUp", remoteInput);
    const queue = (
      await rpc(page, "agent.promptQueue.list", { agentId: child.id })
    ).queuedPrompts;
    expect(
      queue.filter((item) => item.text === "Remote next-run input"),
    ).toHaveLength(1);
    const accepted = queue.find(
      (item) => item.text === "Remote next-run input",
    )!;
    expect(accepted.id).toMatch(/^input_/);
    await expect(
      page.getByText(/pending · user .*next run/).filter({ hasText: "#" }),
    ).toBeVisible();
    await expect(controls).toContainText("pending input");
    await page
      .getByRole("button", { name: "Discard queued prompt", exact: true })
      .last()
      .click();
    await expect
      .poll(async () =>
        (
          await rpc(page, "agent.promptQueue.list", { agentId: child.id })
        ).queuedPrompts.some((item) => item.id === accepted.id),
      )
      .toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const preset of ["developer", "explore"] as const) {
  test(`mobile Context selects ${preset} with ordinary prompt, settings, and pause controls`, async ({
    page,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), "nerve-phone-agent-ui-"));
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      const { project } = await rpc(page, "project.create", { dir });
      const { conversation } = await rpc(page, "conversation.create", {
        projectId: project.id,
        title: `Phone ${preset} controls`,
      });
      const base = {
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider: "nerve-faux", modelId: "faux-fast" },
        permissionLevel: "read_only" as const,
        permissionRuleSetId: "read_only",
      };
      const { agent: root } = await rpc(page, "agent.create", base);
      const { agent: child } = await rpc(page, "agent.create", {
        ...base,
        parentAgentId: root.id,
        name: `Phone ${preset} child`,
        readOnlyCeiling: preset === "explore",
        orchestrationPolicy: {
          preset,
          parentCancellation: "independent",
          completionReporting: "none",
        },
      });
      await page.reload();
      await page
        .getByRole("navigation", { name: "Primary", exact: true })
        .getByRole("button", { name: "Projects", exact: true })
        .click();
      const mobileNavigation = page.locator(".mobile-layer:visible");
      await mobileNavigation
        .getByRole("button", { name: new RegExp(basename(dir)) })
        .click();
      await mobileNavigation
        .getByRole("button", { name: new RegExp(`^${conversation.title}\\b`) })
        .click();
      const controls = page.getByLabel("Agent controls", { exact: true });
      await expect(controls).toContainText("Lead agent");
      await page.getByRole("textbox").first().fill("Mobile root draft");
      await page
        .getByRole("button", { name: "Conversation context", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Context", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: new RegExp(`^${child.name!}`) })
        .click();
      await expect(
        page.getByRole("heading", { name: "Context", exact: true }),
      ).toHaveCount(0);
      await expect(controls).toBeVisible();
      await expect(controls).toContainText(child.name!);
      await controls.getByRole("button", { name: "Pause agent" }).click();
      await expect(
        controls.getByRole("button", { name: "Resume agent" }),
      ).toBeVisible();
      const composer = page.getByRole("textbox").first();
      const prompt = `Phone prompt ${child.id}`;
      await composer.fill(prompt);
      await composer.press("Enter");
      await expect(controls).toContainText("1 pending input");
      await expect
        .poll(async () =>
          (
            await rpc(page, "agent.promptQueue.list", { agentId: child.id })
          ).queuedPrompts.map((item) => item.text),
        )
        .toContain(prompt);
      const rootQueue = (
        await rpc(page, "agent.promptQueue.list", { agentId: root.id })
      ).queuedPrompts;
      // Intervention metadata may queue for the parent despite reporting none;
      // the child user payload must not route there or change the notice owner.
      for (const notice of rootQueue) {
        expect(notice).toMatchObject({
          agentId: root.id,
          conversationId: conversation.id,
          role: "system",
          origin: {
            kind: "system",
            producer: "async_obligation",
            correlationId: expect.stringMatching(/^user_intervention:/),
          },
        });
        expect(notice.text).toContain(child.id);
        expect(notice.text).not.toContain(prompt);
      }
      await controls.getByRole("button", { name: "Agent settings" }).click();
      await page
        .getByRole("textbox", { name: "Instructions", exact: true })
        .fill(`Phone instructions ${child.id}`);
      await page.getByRole("button", { name: "Save agent settings" }).click();
      await expect(controls).toContainText("Pending next turn");
      await expect
        .poll(
          async () =>
            (await rpc(page, "agent.get", { agentId: child.id })).agent
              .instructions,
        )
        .toBe(`Phone instructions ${child.id}`);
      expect(
        (await rpc(page, "agent.get", { agentId: root.id })).agent.instructions,
      ).not.toBe(`Phone instructions ${child.id}`);
      await controls.getByRole("button", { name: "Resume agent" }).click();
      await expect(page.getByText(prompt, { exact: true })).toBeVisible();
      await expect
        .poll(
          async () =>
            (await rpc(page, "agent.history.get", { agentId: child.id }))
              .latestCompletion?.outcome,
        )
        .toBe("completed");
      await expect(controls).not.toContainText("pending input");
      await expect(controls).not.toContainText("Pending next turn");
      await page
        .getByRole("button", { name: "Conversation context", exact: true })
        .click();
      await page.getByRole("button", { name: /^Lead agent/ }).click();
      await expect(controls).toContainText("Lead agent");
      await expect(composer).toHaveText("Mobile root draft");
      await expect(page.getByText(prompt, { exact: true })).toHaveCount(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("switching lead and child during live runs keeps events and history agent-scoped", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-live-agent-ui-"));
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    const { project } = await rpc(page, "project.create", { dir });
    const { conversation } = await rpc(page, "conversation.create", {
      projectId: project.id,
      title: "Live agent switching",
    });
    const base = {
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: "nerve-faux", modelId: "faux-fast" },
      permissionLevel: "read_only" as const,
      permissionRuleSetId: "read_only",
    };
    const { agent: root } = await rpc(page, "agent.create", base);
    const { agent: child } = await rpc(page, "agent.create", {
      ...base,
      parentAgentId: root.id,
      name: "Live switching child",
      orchestrationPolicy: {
        preset: "developer",
        parentCancellation: "independent",
        completionReporting: "none",
      },
    });
    await page.reload();
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: new RegExp(basename(dir)) })
      .click();
    await page.getByText(conversation.title, { exact: true }).first().click();
    await page.getByRole("tab", { name: "Context", exact: true }).click();
    const controls = page.getByLabel("Agent controls", { exact: true });
    const rootPrompt = `Live root ${root.id}`;
    const childPrompt = `Live child ${child.id}`;
    // The API requests and ordinary selection run concurrently. Both agents
    // share a conversation ID, so conversation-only event routing would leak.
    await Promise.all([
      rpc(page, "run.start", { agentId: root.id, text: rootPrompt }),
      rpc(page, "run.start", { agentId: child.id, text: childPrompt }),
      page.getByText(child.name!, { exact: true }).first().click(),
    ]);
    await expect(controls).toContainText(child.name!);
    await expect(page.getByText(childPrompt, { exact: true })).toBeVisible();
    await expect(page.getByText(rootPrompt, { exact: true })).toHaveCount(0);
    await page.getByText("Lead agent", { exact: true }).last().click();
    await expect(controls).toContainText("Lead agent");
    await expect(page.getByText(rootPrompt, { exact: true })).toBeVisible();
    await expect(page.getByText(childPrompt, { exact: true })).toHaveCount(0);
    const getHistory = (agentId: string) =>
      rpc(page, "agent.history.get", { agentId });
    const responses = page.getByText(/I received your prompt:/);
    for (const { agent, prompt, foreignPrompt } of [
      { agent: root, prompt: rootPrompt, foreignPrompt: childPrompt },
      { agent: child, prompt: childPrompt, foreignPrompt: rootPrompt },
    ]) {
      await expect
        .poll(
          async () => (await getHistory(agent.id)).latestCompletion?.outcome,
        )
        .toBe("completed");
      const history = await getHistory(agent.id);
      expect(history).toMatchObject({
        agentId: agent.id,
        conversationId: conversation.id,
        latestCompletion: { agentId: agent.id, outcome: "completed" },
      });
      expect(history.entries.map((entry) => entry.agentId)).toEqual(
        history.entries.map(() => agent.id),
      );
      expect(history.entries.find((entry) => entry.text === prompt)?.role).toBe(
        "user",
      );
      expect(
        history.entries.some((entry) => entry.text?.includes(foreignPrompt)),
      ).toBe(false);
    }
    // Faux may echo a newer parent intervention notice; retain the root user UX.
    await expect(page.getByText(rootPrompt, { exact: true })).toBeVisible();
    await expect(page.getByText(childPrompt, { exact: true })).toHaveCount(0);
    await expect(responses.filter({ visible: true })).not.toHaveCount(0);
    await expect(responses.filter({ hasText: childPrompt })).toHaveCount(0);
    await page.getByText(child.name!, { exact: true }).first().click();
    await expect(responses).toContainText(childPrompt);
    await expect(responses.filter({ hasText: rootPrompt })).toHaveCount(0);
    await expect(page.getByText(rootPrompt, { exact: true })).toHaveCount(0);
    // A new child run must still target the selected identity after live root
    // events and snapshot hydration have both been applied, without a reload.
    const followUp = `Live selected follow-up ${child.id}`;
    const composer = page.getByRole("textbox").first();
    await composer.fill(followUp);
    await composer.press("Enter");
    await expect(page.getByText(followUp, { exact: true })).toBeVisible();
    await expect
      .poll(async () => JSON.stringify(await getHistory(child.id)))
      .toContain(followUp);
    await page.getByText("Lead agent", { exact: true }).last().click();
    await expect(page.getByText(followUp, { exact: true })).toHaveCount(0);
    await expect(page.getByText(rootPrompt, { exact: true })).toBeVisible();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
