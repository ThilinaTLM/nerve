/**
 * Screenshot scene definitions.
 *
 * One entry per published asset pair. `drive` receives a Playwright page that
 * has already loaded the workbench, selected the demo project, and settled;
 * it must leave the UI in the exact state to be captured. Scenes are captured
 * twice — once per colour mode — so `drive` must be idempotent.
 */

/** Desktop sources are 1440x900 at DPR 2 -> 2880x1800. */
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
export const DESKTOP_SCALE = 2;

/** Phone sources are 390x844 at DPR 3 -> 1170x2532. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };
export const MOBILE_SCALE = 3;

const DEMO_PROJECT = "Aurora";
const RATE_LIMIT_CONVERSATION = "Add rate limiting to the booking API";
const DEPLOY_CONVERSATION = "Investigate flaky staging deploys";

async function selectProject(page, name = DEMO_PROJECT) {
  await page.getByRole("button", { name: "Switch project" }).click();
  const option = page.getByRole("option", {
    name: new RegExp(`^${name}(?:, current project)?$`),
  });
  await option.click();
  await page.waitForTimeout(500);
}

async function openConversation(page, title) {
  await selectProject(page);
  await page.getByRole("tab", { name: "Conversations" }).first().click();
  await page.getByText(title, { exact: false }).first().click();
  await openRightPanel(page, "Git");
  await page.waitForTimeout(600);
}

async function openRightPanel(page, name) {
  await page
    .locator('section[data-dock="right"]')
    .getByRole("tab", { name })
    .first()
    .click();
  await page.waitForTimeout(400);
}

export const DESKTOP_SCENES = [
  {
    id: "projects",
    alt: "The Nerve project switcher showing three active local projects and their workspace paths",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page.getByRole("button", { name: "Switch project" }).click();
      await page.getByPlaceholder("Search projects").focus();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "conversation",
    alt: "A Nerve conversation with the activity island expanded to show five retained profile-based sub-agents and a retained background command",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page
        .getByText("All profile-based reviews are complete.", { exact: false })
        .scrollIntoViewIfNeeded();
      await page.mouse.move(650, 450);
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /^Agents: / }).click();
      await page.getByRole("region", { name: "Agents", exact: true }).waitFor();
    },
  },
  {
    id: "async-bash",
    alt: "The conversation activity island showing a completed asynchronous bash command",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page
        .getByText("All profile-based reviews are complete.", { exact: false })
        .scrollIntoViewIfNeeded();
      await page.mouse.move(650, 450);
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /^Commands: / }).click();
      await page
        .getByRole("region", { name: "Commands", exact: true })
        .waitFor();
    },
  },
  {
    id: "git",
    alt: "The Nerve Git panel with four repositories in one project, showing staged and unstaged changes in the selected repository",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await openRightPanel(page, "Git");
      const repo = page.getByRole("group", { name: "Repository" });
      if (await repo.isVisible().catch(() => false)) {
        await repo.getByText("aurora-api").first().click();
        await page.waitForTimeout(400);
      }
    },
  },
  {
    id: "editor",
    alt: "The Nerve built-in text editor with an unsaved rate-limit draft, project file tree, and Git changes",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page.getByRole("tab", { name: "Files", exact: true }).click();
      const tree = page.getByRole("tree", { name: "Aurora files" });
      for (const name of ["aurora-api", "src", "middleware"]) {
        const folder = tree.getByRole("treeitem", { name, exact: true });
        await folder.click();
      }
      await tree.getByRole("treeitem", { name: /rate-limit\.ts/ }).click();
      const editor = page.getByRole("textbox", {
        name: /File contents: .*rate-limit\.ts/,
      });
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      await page.keyboard.insertText(
        "// Keep burst capacity configurable for busy booking windows.\n",
      );
      await page.keyboard.press("ControlOrMeta+Home");
      await page.waitForTimeout(500);
    },
  },
  {
    id: "history",
    alt: "The Nerve conversation history graph zoomed into a cluster where several branches diverge from earlier entries",
    async drive(page) {
      await openConversation(page, DEPLOY_CONVERSATION);
      /* History is reached from the transcript context menu, which is also how
       * a user finds it. */
      await page
        .getByText("Staging deploys fail roughly one run in four", {
          exact: false,
        })
        .first()
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Branch history" }).click();
      await page.waitForSelector('[data-tour-id="conversation-history"]');
      await page.waitForTimeout(1200);
      const closeDetails = page.getByRole("button", {
        name: "Close details",
        exact: true,
      });
      if (await closeDetails.isVisible()) await closeDetails.click();
      await page.getByRole("button", { name: "Fit entire graph" }).click();
      await page.waitForTimeout(400);
      /* Zoom past the graph's "detail" tier (0.85) so node cards render their
       * text; a fitted graph shows shape but no readable content. */
      const zoomIn = page.getByRole("button", { name: "Zoom in" });
      for (let index = 0; index < 4; index += 1) {
        await zoomIn.click();
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(800);
    },
  },
  {
    id: "launches",
    alt: "The Nerve Launches panel showing saved project launch configurations and a completed verification run with retained output",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page
        .locator('section[data-dock="left"], section[data-dock="bottom"]')
        .getByRole("tab", { name: "Launches" })
        .first()
        .click();
      await page.waitForTimeout(600);
      const row = page
        .getByRole("listitem")
        .filter({ hasText: "aurora-api tests" });
      const output = row.getByRole("button", { name: /aurora-api tests/ });
      // Start once in the throwaway workspace; reuse that exact run in dark mode.
      if (await output.isDisabled()) {
        await row
          .getByRole("button", { name: "Run launch", exact: true })
          .click();
        await page.waitForTimeout(1500);
      }
      await output.click();
      await page.waitForTimeout(6000);
    },
  },
  {
    id: "pull-request",
    /* Pull-request data cannot be synthesized: it needs a real remote. This
     * scene is captured against the project's own public repository and is
     * skipped unless the capture environment is authenticated with GitHub. */
    requiresGitHub: true,
    alt: "A Nerve pull request view with the summary, mergeability, checks, and changed files beside the list of open pull requests",
    async drive(page) {
      await selectProject(page);
      await openRightPanel(page, "Pull requests");
      /* The PR scene uses the cloned public repository, not the synthetic
       * ones, which have no remote. */
      await page
        .locator('section[data-dock="right"]')
        .getByRole("group", { name: "Repository" })
        .getByText("nerve", { exact: true })
        .click();
      await page.waitForTimeout(6_000);
      /* The title button opens the detail tab; the sibling icon buttons copy
       * the link or open GitHub in a browser, so target the title by its
       * `title="<pr title> · <base> ← <head>"` tooltip. */
      await page
        .locator('section[data-dock="right"] button[title*="←"]')
        .first()
        .click();
      /* Mergeability and checks are fetched after the detail tab opens; a
       * shorter wait captures a "Calculating mergeability" placeholder. */
      await page.waitForTimeout(12_000);
    },
  },
];

/* Phone width opens on Inbox with recent conversations. Opening one pushes
 * the transcript as a full-screen detail view. */
async function openMobileRoot(page) {
  const navigation = page.getByRole("navigation", { name: "Primary" });
  for (
    let depth = 0;
    depth < 5 && !(await navigation.isVisible());
    depth += 1
  ) {
    await page.getByRole("button", { name: /^Back/ }).first().click();
  }
  await navigation.waitFor();
}

async function openMobileConversation(page, title = RATE_LIMIT_CONVERSATION) {
  await openMobileRoot(page);
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await page.waitForTimeout(1200);
  // Let virtual rows finish measuring before fixing the final reading position.
  for (let pass = 0; pass < 3; pass += 1) {
    await page
      .getByRole("region", { name: "Conversation transcript", exact: true })
      .evaluate((viewport) => {
        viewport.scrollTop = viewport.scrollHeight;
      });
    await page.waitForTimeout(600);
  }
  const review = await page
    .getByRole("button", { name: "Open Middleware review", exact: true })
    .boundingBox();
  if (!review)
    throw new Error("The retained middleware review must be visible");
  await page
    .getByRole("region", { name: "Conversation transcript", exact: true })
    .evaluate((viewport, delta) => {
      viewport.scrollTop += delta;
    }, review.y - 320);
  await page.waitForTimeout(600);
}

export const MOBILE_SCENES = [
  {
    id: "conversation",
    alt: "The Nerve conversation and composer at phone width",
    async drive(page) {
      await openMobileConversation(page);
      await page.waitForTimeout(600);
    },
  },
  {
    id: "model-picker",
    alt: "The Nerve model and reasoning-effort picker open at phone width",
    async drive(page) {
      await openMobileConversation(page);
      /* Open the fixed composer picker after the transcript has settled. */
      await page.waitForTimeout(500);
      await page.locator('[data-tour-id="composer-model"]:visible').click();
      await page.waitForTimeout(500);
    },
  },
  {
    id: "right-sheet",
    alt: "The Nerve Git Changes screen opened from the phone project home",
    async drive(page) {
      await openMobileRoot(page);
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.getByRole("button", { name: /^Aurora / }).click();
      await page.getByRole("button", { name: /^Git changes/ }).click();
      await page.waitForTimeout(800);
    },
  },
];
