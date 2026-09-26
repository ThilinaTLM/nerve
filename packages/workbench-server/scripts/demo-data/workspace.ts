/**
 * Synthetic multi-project workspaces for website screenshots.
 *
 * Everything here is invented: the projects and author are not real, and no
 * path, host, or account outside the throwaway capture directory is referenced.
 * Commits use fixed timestamps so repeated seeds produce the same history.
 */

import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const AUTHOR_NAME = "Aurora Demo";
const AUTHOR_EMAIL = "demo@aurora.example";

/** Fixed clock so seeded history does not drift between captures. */
const BASE_TIME = Date.parse("2026-03-02T09:00:00.000Z");

export interface DemoProject {
  /** Stable directory and storage identifier. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly repositories: readonly DemoRepo[];
}

export interface DemoRepo {
  readonly name: string;
  readonly description: string;
  readonly branches: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly commits: readonly { readonly message: string }[];
  /** Files left modified in the working tree after the last commit. */
  readonly dirty?: Readonly<Record<string, string>>;
  /** Files modified and then staged, to show a mixed index. */
  readonly staged?: Readonly<Record<string, string>>;
}

const AURORA_REPOS: readonly DemoRepo[] = [
  {
    name: "aurora-api",
    description: "Booking API service",
    branches: ["main", "feat/rate-limiting", "fix/booking-timezones"],
    files: {
      "package.json": `{
  "name": "aurora-api",
  "version": "2.4.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "node --test \\"test/**/*.test.ts\\""
  }
}
`,
      "src/server.ts": `import { createServer } from "node:http";
import { router } from "./router.js";

const port = Number(process.env.PORT ?? 8080);

createServer(router).listen(port, () => {
  console.log(\`aurora-api listening on \${port}\`);
});
`,
      "src/router.ts": `import { bookingRoutes } from "./routes/bookings.js";
import { venueRoutes } from "./routes/venues.js";

export const router = compose([bookingRoutes, venueRoutes]);
`,
      "src/routes/bookings.ts": `export const bookingRoutes = route("/bookings", {
  list: listBookings,
  create: createBooking,
  cancel: cancelBooking,
});
`,
      "src/routes/venues.ts": `export const venueRoutes = route("/venues", {
  list: listVenues,
  availability: venueAvailability,
});
`,
      "src/middleware/rate-limit.ts": `export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function rateLimit(options: RateLimitOptions) {
  const hits = new Map<string, number[]>();
  return (request: Request) => {
    const now = Date.now();
    const key = clientKey(request);
    const recent = (hits.get(key) ?? []).filter(
      (at) => now - at < options.windowMs,
    );
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= options.max;
  };
}
`,
      "README.md": `# aurora-api

Booking API for the Aurora demo workspace.
`,
    },
    commits: [
      { message: "Extract venue availability into its own route" },
      { message: "Add booking cancellation endpoint" },
      { message: "Harden request validation on /bookings" },
      { message: "Introduce a rate limit middleware skeleton" },
      { message: "Cache venue lookups for the availability endpoint" },
    ],
    staged: {
      "src/middleware/rate-limit.ts": `export interface RateLimitOptions {
  windowMs: number;
  max: number;
  burst?: number;
}

export function rateLimit(options: RateLimitOptions) {
  const hits = new Map<string, number[]>();
  const burst = options.burst ?? options.max;
  return (request: Request) => {
    const now = Date.now();
    const key = clientKey(request);
    const recent = (hits.get(key) ?? []).filter(
      (at) => now - at < options.windowMs,
    );
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= burst;
  };
}
`,
    },
    dirty: {
      "src/routes/bookings.ts": `import { rateLimit } from "../middleware/rate-limit.js";

const limit = rateLimit({ windowMs: 60_000, max: 120, burst: 160 });

export const bookingRoutes = route("/bookings", {
  list: listBookings,
  create: limit(createBooking),
  cancel: cancelBooking,
});
`,
    },
  },
  {
    name: "aurora-web",
    description: "Customer web app",
    branches: ["main", "feat/design-tokens"],
    files: {
      "package.json": `{
  "name": "aurora-web",
  "version": "1.9.2",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "test": "vitest run"
  }
}
`,
      "src/routes/+page.svelte": `<script lang="ts">
  import VenueCard from "$lib/VenueCard.svelte";
  let { data } = $props();
</script>

{#each data.venues as venue}
  <VenueCard {venue} />
{/each}
`,
      "src/lib/VenueCard.svelte": `<script lang="ts">
  let { venue } = $props();
</script>

<article class="venue-card">
  <h3>{venue.name}</h3>
  <p>{venue.capacity} seats</p>
</article>
`,
      "src/lib/tokens.css": `:root {
  --surface: oklch(98% 0.01 250);
  --surface-raised: oklch(100% 0 0);
  --text: oklch(24% 0.02 250);
  --accent: oklch(62% 0.16 250);
}
`,
      "README.md": `# aurora-web

Customer-facing booking app for the Aurora demo workspace.
`,
    },
    commits: [
      { message: "Move venue list into a reusable card" },
      { message: "Add design token stylesheet" },
      { message: "Use tokens for the venue card surface" },
      { message: "Fix availability label wrapping on narrow screens" },
    ],
  },
  {
    name: "aurora-infra",
    description: "Deployment and infrastructure",
    branches: ["main", "chore/staging-parity"],
    files: {
      "compose.yaml": `services:
  api:
    build: ../aurora-api
    ports:
      - "8080:8080"
  web:
    build: ../aurora-web
    ports:
      - "5173:5173"
`,
      "deploy/staging.tf": `resource "aurora_service" "api" {
  name     = "aurora-api"
  replicas = 2
  cpu      = "500m"
}

resource "aurora_service" "web" {
  name     = "aurora-web"
  replicas = 2
  cpu      = "250m"
}
`,
      "deploy/production.tf": `resource "aurora_service" "api" {
  name     = "aurora-api"
  replicas = 6
  cpu      = "1000m"
}
`,
      "README.md": `# aurora-infra

Compose and Terraform definitions for the Aurora demo workspace.
`,
    },
    commits: [
      { message: "Describe the staging service topology" },
      { message: "Raise production API replica count" },
      { message: "Pin the compose build contexts" },
    ],
  },
  {
    name: "aurora-mobile",
    description: "Field staff mobile app",
    branches: ["main"],
    files: {
      "package.json": `{
  "name": "aurora-mobile",
  "version": "0.7.1",
  "type": "module",
  "scripts": {
    "dev": "expo start"
  }
}
`,
      "app/index.tsx": `import { BookingList } from "../components/BookingList";

export default function Home() {
  return <BookingList />;
}
`,
      "components/BookingList.tsx": `export function BookingList() {
  return <List source="/bookings" empty="No bookings today" />;
}
`,
      "README.md": `# aurora-mobile

Field staff app for the Aurora demo workspace.
`,
    },
    commits: [
      { message: "Scaffold the booking list screen" },
      { message: "Show an empty state when the day is clear" },
    ],
  },
];

const NORTHSTAR_REPOS: readonly DemoRepo[] = [
  {
    name: "northstar-journal",
    description: "Offline-first garden journal",
    branches: ["main", "feat/season-summary"],
    files: {
      "package.json": `{
  "name": "northstar-journal",
  "version": "0.5.0",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "test": "vitest run"
  }
}
`,
      "src/entries.ts": `export interface GardenEntry {
  plantedOn: string;
  crop: string;
  notes: string;
}

export function entriesForMonth(entries: GardenEntry[], month: string) {
  return entries.filter((entry) => entry.plantedOn.startsWith(month));
}
`,
      "src/storage.ts": `import type { GardenEntry } from "./entries.js";

const STORAGE_KEY = "northstar.entries";

export function saveEntries(entries: GardenEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function loadEntries(): GardenEntry[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
}
`,
      "src/season-summary.ts": `import type { GardenEntry } from "./entries.js";

export function cropTotals(entries: GardenEntry[]) {
  return Map.groupBy(entries, (entry) => entry.crop);
}
`,
      "test/entries.test.ts": `import { expect, test } from "vitest";
import { entriesForMonth } from "../src/entries.js";

test("selects entries in the requested month", () => {
  const entries = [
    { plantedOn: "2026-03-08", crop: "peas", notes: "north bed" },
    { plantedOn: "2026-04-02", crop: "chard", notes: "two rows" },
  ];
  expect(entriesForMonth(entries, "2026-03")).toHaveLength(1);
});
`,
      "README.md": `# Northstar Journal

A small offline garden journal for tracking plantings through the season.
`,
    },
    commits: [
      { message: "Store journal entries in the browser" },
      { message: "Filter planting notes by month" },
      { message: "Cover monthly entry filtering" },
      { message: "Draft crop totals for the season summary" },
    ],
    dirty: {
      "src/season-summary.ts": `import type { GardenEntry } from "./entries.js";

export function cropTotals(entries: GardenEntry[]) {
  return Array.from(
    Map.groupBy(entries, (entry) => entry.crop),
    ([crop, cropEntries]) => ({ crop, count: cropEntries.length }),
  ).sort((left, right) => left.crop.localeCompare(right.crop));
}
`,
    },
  },
];

const RELAYBOARD_REPOS: readonly DemoRepo[] = [
  {
    name: "relayboard-cli",
    description: "Command-line shift handoff notebook",
    branches: ["main", "feat/json-export"],
    files: {
      "package.json": `{
  "name": "relayboard-cli",
  "version": "0.3.1",
  "type": "module",
  "bin": { "relayboard": "src/cli.js" },
  "scripts": { "test": "node --test" }
}
`,
      "src/cli.js": `import { readFile } from "node:fs/promises";
import { formatHandoff } from "./format.js";

const file = process.argv[2] ?? "handoff.json";
const handoff = JSON.parse(await readFile(file, "utf8"));
console.log(formatHandoff(handoff));
`,
      "src/format.js": `export function formatHandoff({ shift, owner, items }) {
  const heading = \`# \${shift} handoff — \${owner}\`;
  const checklist = items.map((item) => \`- [ ] \${item}\`).join("\\n");
  return \`\${heading}\\n\\n\${checklist}\`;
}
`,
      "test/format.test.js": `import assert from "node:assert/strict";
import test from "node:test";
import { formatHandoff } from "../src/format.js";

test("formats handoff items as a checklist", () => {
  const result = formatHandoff({
    shift: "evening",
    owner: "Sam",
    items: ["Review queue"],
  });
  assert.match(result, /- \\[ \\] Review queue/);
});
`,
      "examples/handoff.json": `{
  "shift": "morning",
  "owner": "Morgan",
  "items": ["Check overnight alerts", "Confirm delivery window"]
}
`,
      "README.md": `# Relayboard CLI

A tiny local tool that turns shift notes into a consistent handoff checklist.
`,
    },
    commits: [
      { message: "Format handoff notes as a checklist" },
      { message: "Accept a handoff file from the command line" },
      { message: "Add a representative morning shift example" },
    ],
    staged: {
      "src/export.js": `export function exportHandoff(handoff) {
  return JSON.stringify(handoff, null, 2) + "\\n";
}
`,
    },
    dirty: {
      "src/cli.js": `import { readFile } from "node:fs/promises";
import { formatHandoff } from "./format.js";

const file = process.argv[2] ?? "handoff.json";
const handoff = JSON.parse(await readFile(file, "utf8"));
const output = process.argv.includes("--json")
  ? JSON.stringify(handoff, null, 2)
  : formatHandoff(handoff);
console.log(output);
`,
    },
  },
];

const AURORA_PROJECT: DemoProject = {
  id: "aurora",
  name: "Aurora",
  description:
    "Venue booking platform spanning web, API, mobile, and infrastructure",
  repositories: AURORA_REPOS,
};

/** Synthetic projects available to the demo-home seeder. */
export const DEMO_PROJECTS: readonly DemoProject[] = [
  AURORA_PROJECT,
  {
    id: "northstar",
    name: "Northstar Journal",
    description: "Offline-first garden journal",
    repositories: NORTHSTAR_REPOS,
  },
  {
    id: "relayboard",
    name: "Relayboard",
    description: "Lightweight shift handoff tooling",
    repositories: RELAYBOARD_REPOS,
  },
];

async function git(
  cwd: string,
  args: string[],
  commitIndex = 0,
): Promise<void> {
  const stamp = new Date(BASE_TIME + commitIndex * 3_600_000).toISOString();
  await run("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
      GIT_AUTHOR_DATE: stamp,
      GIT_COMMITTER_DATE: stamp,
    },
  });
}

async function writeTree(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

/**
 * Creates the demo workspace on disk. Returns the workspace root that should
 * be opened as the Nerve project.
 */
export async function createDemoWorkspace(
  root: string,
  project: DemoProject,
): Promise<string> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  for (const repo of project.repositories) {
    const repoRoot = join(root, repo.name);
    await mkdir(repoRoot, { recursive: true });
    await git(repoRoot, ["init", "--initial-branch", "main"]);
    await git(repoRoot, ["config", "user.name", AUTHOR_NAME]);
    await git(repoRoot, ["config", "user.email", AUTHOR_EMAIL]);
    await git(repoRoot, ["config", "commit.gpgsign", "false"]);

    await writeTree(repoRoot, repo.files);
    await git(repoRoot, ["add", "."]);
    await git(repoRoot, ["commit", "-m", "Initial import"], 0);

    /* Each later commit touches the README so the log reads as real work
     * without needing a distinct file per message. */
    for (const [index, commit] of repo.commits.entries()) {
      const note = `${repo.files["README.md"] ?? ""}\n- ${commit.message}\n`;
      await writeFile(join(repoRoot, "README.md"), note, "utf8");
      await git(repoRoot, ["add", "."]);
      await git(repoRoot, ["commit", "-m", commit.message], index + 1);
    }

    for (const branch of repo.branches.slice(1)) {
      await git(repoRoot, ["branch", branch]);
    }

    if (repo.staged) {
      await writeTree(repoRoot, repo.staged);
      await git(repoRoot, ["add", "."]);
    }
    if (repo.dirty) await writeTree(repoRoot, repo.dirty);
  }

  return root;
}

/**
 * Pull-request data cannot be synthesized: it needs a real remote. The PR scene
 * therefore uses the project's own public repository, added only when the
 * capture explicitly opts in. Everything it shows is public GitHub data.
 */
export async function addPublicPullRequestRepo(root: string): Promise<void> {
  const target = join(root, "nerve");
  await rm(target, { recursive: true, force: true });
  await run("git", [
    "clone",
    "--depth",
    "50",
    "--no-single-branch",
    "https://github.com/ThilinaTLM/nerve.git",
    target,
  ]);
}
