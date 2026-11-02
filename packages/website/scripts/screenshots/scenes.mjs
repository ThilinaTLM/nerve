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
const RICH_CONVERSATION = "Compare limiter strategies for POST /bookings";
/** The seed's workspace parent, so the folder browser shows demo folders only. */
const DEMO_WORKSPACE_ROOT = "/tmp/nerve-demo-workspace";

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
    id: "ask-user",
    alt: "A booking rollout decision with recommended options, an answer field, and the conversation composer",
    async drive(page) {
      await openConversation(page, "Choose the booking limiter rollout");
      await page
        .getByText("How should we roll out the booking limiter?", {
          exact: true,
        })
        .waitFor();
      /* The pending question is a real card with selectable options. */
      await page.getByRole("button", { name: /Staging first/ }).waitFor();
    },
  },
  {
    id: "notifications",
    alt: "The Notifications popover listing a question that needs an answer, a failed agent, and a stopped agent, with mute and clear actions",
    async drive(page) {
      await openConversation(page, RATE_LIMIT_CONVERSATION);
      await page.getByRole("button", { name: /^Notifications/ }).click();
      await page
        .getByRole("button", { name: "Mute 1 h", exact: true })
        .waitFor();
      await page.getByText("Question for you", { exact: true }).waitFor();
    },
  },
  {
    id: "folder-browser",
    alt: "The Open project folder browser showing places, a path bar, and nested demo folders",
    async drive(page) {
      await selectProject(page);
      await page.getByRole("button", { name: "Switch project" }).click();
      await page.getByRole("button", { name: /^Open folder/ }).click();
      const dialog = page.getByRole("dialog", { name: /Open project/ });
      await dialog.waitFor();
      /* Never show the real home directory: jump to the throwaway workspace. */
      await dialog.getByRole("button", { name: /edit path/i }).click();
      await page.keyboard.insertText(DEMO_WORKSPACE_ROOT);
      await page.keyboard.press("Enter");
      await dialog.getByText("archive", { exact: true }).waitFor();
      await dialog.getByText("archive", { exact: true }).click();
    },
  },
  {
    id: "quote",
    alt: "A rich assistant reply with a text selection and the floating Quote and Quote and dictate toolbar",
    async drive(page) {
      await openConversation(page, RICH_CONVERSATION);
      const item = page
        .getByRole("listitem")
        .filter({ hasText: "Shared counter store" })
        .first();
      await item.evaluate((node) =>
        node.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await page.waitForTimeout(500);
      const box = await item.boundingBox();
      if (!box) throw new Error("The rich reply must be visible");
      /* Drag across the sentence like a user; a pointer-up raises the toolbar. */
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
        steps: 8,
      });
      await page.mouse.up();
      await page.getByRole("toolbar", { name: "Selection actions" }).waitFor();
    },
  },
  {
    id: "discover",
    alt: "The Discover page with the release story, setup steps, and tips",
    async drive(page) {
      await selectProject(page);
      await page.getByRole("button", { name: /^Open Discover/ }).click();
      await page.waitForTimeout(800);
    },
  },
  {
    id: "themes",
    alt: "Settings, Workbench, Appearance with the theme picker previewing the five Nerve themes",
    async drive(page) {
      await selectProject(page);
      await page.getByRole("button", { name: "Open settings" }).click();
      await page
        .getByRole("button", { name: "Workbench", exact: true })
        .click();
      await page.getByText("Appearance", { exact: true }).first().waitFor();
    },
  },
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
      await page
        .getByRole("button", {
          name: "Select repository aurora-api",
          exact: true,
        })
        .click();
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
      await page.getByRole("button", { name: "Fit tree" }).click();
      await page.waitForTimeout(1200);
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
        .getByRole("treeitem")
        .filter({ hasText: "aurora-api tests" });
      const output = row.getByRole("button", { name: /aurora-api tests/ });
      // Start once in the throwaway workspace; reuse that exact run in dark mode.
      if (
        await row
          .getByRole("img", { name: "Not run yet", exact: true })
          .isVisible()
      ) {
        await row
          .getByRole("button", { name: "Run launch", exact: true })
          .click();
        await row
          .getByRole("img", { name: "Completed", exact: true })
          .waitFor();
      }
      await output.click();
      await page.waitForTimeout(6000);
    },
  },
  {
    id: "pull-request",
    /* GitHub reads are synthetic browser fixtures; no auth or remote needed. */
    alt: "A Nerve pull request view with the summary, mergeability, checks, and changed files beside the list of open pull requests",
    async drive(page) {
      await selectProject(page);
      await openRightPanel(page, "Pull requests");
      await page
        .getByRole("button", {
          name: "Select repository aurora-api",
          exact: true,
        })
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
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: /^Inbox(?:,|$)/ })
    .click();
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
    id: "composer-sheet",
    alt: "The compact phone composer with the agent profile bottom sheet open",
    async drive(page) {
      await openMobileConversation(page);
      await page.waitForTimeout(500);
      await page
        .getByRole("button", { name: "Conversation settings" })
        .last()
        .click();
      await page.waitForTimeout(600);
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
