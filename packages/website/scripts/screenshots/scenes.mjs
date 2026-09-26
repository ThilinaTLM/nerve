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
      await selectProject(page);
      await page.getByRole("button", { name: "Switch project" }).click();
      await page.getByPlaceholder("Search projects").focus();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "conversation",
    alt: "A Nerve conversation showing file edits, a background verification task, retained output, and the composer",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(500);
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
      await page.getByRole("button", { name: "Fit entire graph" }).click();
      await page.waitForTimeout(400);
      /* Zoom past the graph's "detail" tier (0.85) so node cards render their
       * text; a fitted graph shows shape but no readable content. */
      const zoomIn = page.getByRole("button", { name: "Zoom in" });
      for (let index = 0; index < 6; index += 1) {
        await zoomIn.click();
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(800);
    },
  },
  {
    id: "tasks",
    alt: "The Nerve tasks panel listing a running development server and completed validation runs beside their retained output",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page
        .locator('section[data-dock="left"], section[data-dock="bottom"]')
        .getByRole("tab", { name: "Tasks" })
        .first()
        .click();
      await page.waitForTimeout(600);
      /* Deliberately no clicks inside the panel: its row controls are restart
       * and delete actions, and a capture must never mutate demo state. */
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

/* Phone width uses a tabbed root with conversations under Chats. Opening one
 * pushes the transcript as a full-screen detail view. */
async function openMobileConversation(page, title = RATE_LIMIT_CONVERSATION) {
  await page.getByRole("button", { name: "Chats" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await page.waitForTimeout(1200);
}

export const MOBILE_SCENES = [
  {
    id: "conversation",
    alt: "The Nerve conversation and composer at phone width",
    async drive(page) {
      await openMobileConversation(page);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(600);
    },
  },
  {
    id: "model-picker",
    alt: "The Nerve model and reasoning-effort picker open at phone width",
    async drive(page) {
      await openMobileConversation(page);
      /* The phone transcript opens at its saved reading position. Bring the
       * fixed composer controls into the rendered viewport before opening the
       * picker. */
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(500);
      await page.locator('[data-tour-id="composer-model"]:visible').click();
      await page.waitForTimeout(500);
    },
  },
  {
    id: "right-sheet",
    alt: "The Nerve Git Changes screen opened from the phone workspace tab",
    async drive(page) {
      await page.getByRole("button", { name: "Workspace" }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^Git Changes/ }).click();
      await page.waitForTimeout(800);
    },
  },
];
