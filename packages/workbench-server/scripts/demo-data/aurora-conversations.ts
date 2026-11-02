import type { DemoConversation } from "./conversation-types.js";

export const rateLimiting: DemoConversation = {
  title: "Add rate limiting to the booking API",
  agentProfile: "coding",
  permissionRuleSetId: "supervised",
  ageHours: 2,
  pinned: true,
  references: [
    {
      kind: "pull_request",
      repository: "aurora-demo/aurora-api",
      number: 42,
      relationship: "created",
    },
    {
      kind: "issue",
      repository: "aurora-demo/aurora-api",
      number: 37,
      relationship: "referenced",
    },
  ],
  asyncCommand: "pnpm test --filter rate-limit",
  children: [
    {
      name: "Middleware review",
      profile: "explore",
      task: "Review rate-limit middleware and edge cases.",
      report:
        "The burst option is wired correctly. The limit is per replica; shared state would be needed for a fleet-wide cap.",
    },
    {
      name: "Booking route review",
      profile: "explore",
      task: "Check booking route wiring and validation coverage.",
      report:
        "POST /bookings uses the limiter. Existing booking validation remains unchanged.",
    },
    {
      name: "Abuse case review",
      profile: "explore",
      task: "Review client-key abuse risks during festival booking on-sales.",
      report:
        "The limiter counts by client key, not by event or booking. Rotating keys can spread traffic across buckets; verify client-key trust at the proxy boundary before treating this as abuse protection.",
    },
    {
      name: "Test coverage review",
      profile: "explore",
      task: "Review rate-limit test results and identify boundary coverage gaps.",
      report:
        "The focused run reports 3 passing tests. Add explicit coverage for the 160-request burst boundary, expiry after the 60 second window, and isolation between client keys before relying on those edge cases.",
    },
    {
      name: "Rollout review",
      profile: "explore",
      task: "Review operational limits and rollout checks for the booking limiter.",
      report:
        "The in-process counters reset on restart and apply independently per replica. Monitor rejected POST /bookings requests during a staged rollout; a fleet-wide cap remains a separate shared-state change.",
    },
  ],
  steps: [
    {
      type: "user",
      text: "The booking endpoints get hammered during festival on-sales. Add rate limiting to POST /bookings, reusing the middleware skeleton if it is usable.",
    },
    {
      type: "assistant",
      text: "Let me look at the existing middleware and the booking routes before changing anything.",
      thinking:
        "There is already a rate-limit middleware skeleton in aurora-api. If it holds a sliding window per client key it only needs a burst option and wiring into the create handler, which is a much smaller change than writing a new limiter.",
    },
    {
      type: "tool",
      toolName: "read",
      risk: "read",
      repo: "aurora-api",
      args: { path: "src/middleware/rate-limit.ts" },
      result: {
        path: "src/middleware/rate-limit.ts",
        content:
          "export interface RateLimitOptions {\n  windowMs: number;\n  max: number;\n}\n\nexport function rateLimit(options: RateLimitOptions) {\n  const hits = new Map<string, number[]>();\n  return (request: Request) => {\n    const now = Date.now();\n    const key = clientKey(request);\n    const recent = (hits.get(key) ?? []).filter(\n      (at) => now - at < options.windowMs,\n    );\n    recent.push(now);\n    hits.set(key, recent);\n    return recent.length <= options.max;\n  };\n}\n",
        lines: 18,
      },
    },
    {
      type: "tool",
      toolName: "grep",
      risk: "read",
      repo: "aurora-api",
      args: { pattern: "rateLimit", glob: "src/**/*.ts" },
      result: {
        matches: [
          {
            path: "src/middleware/rate-limit.ts",
            line: 6,
            text: "export function rateLimit(options: RateLimitOptions) {",
          },
          {
            path: "src/routes/bookings.ts",
            line: 1,
            text: 'import { rateLimit } from "../middleware/rate-limit.js";',
          },
        ],
      },
    },
    {
      type: "assistant",
      text: "The middleware exists but nothing calls it. I will add a burst allowance and wire it into the create handler.",
    },
    {
      type: "tool",
      toolName: "edit",
      risk: "workspace_write",
      repo: "aurora-api",
      args: {
        path: "src/middleware/rate-limit.ts",
        edits: [
          {
            oldText: "max: number;",
            newText: "max: number;\n  burst?: number;",
          },
        ],
      },
      result: {
        path: "src/middleware/rate-limit.ts",
        details: {
          diff: "@@ -1,4 +1,5 @@\n export interface RateLimitOptions {\n   windowMs: number;\n   max: number;\n+  burst?: number;\n }\n@@ -9,7 +10,8 @@\n     const now = Date.now();\n     const key = clientKey(request);\n+    const burst = options.burst ?? options.max;\n     const recent = (hits.get(key) ?? []).filter(\n       (at) => now - at < options.windowMs,\n     );\n-    return recent.length <= options.max;\n+    return recent.length <= burst;",
          operationCount: 2,
          dryRun: false,
        },
      },
    },
    {
      type: "tool",
      toolName: "edit",
      risk: "workspace_write",
      repo: "aurora-api",
      args: {
        path: "src/routes/bookings.ts",
        edits: [
          {
            oldText: "create: createBooking,",
            newText: "create: limit(createBooking),",
          },
        ],
      },
      result: {
        path: "src/routes/bookings.ts",
        details: {
          diff: '@@ -1,6 +1,9 @@\n+import { rateLimit } from "../middleware/rate-limit.js";\n+\n+const limit = rateLimit({ windowMs: 60_000, max: 120, burst: 160 });\n+\n export const bookingRoutes = route("/bookings", {\n   list: listBookings,\n-  create: createBooking,\n+  create: limit(createBooking),\n   cancel: cancelBooking,\n });',
          operationCount: 2,
          dryRun: false,
        },
      },
    },
    {
      type: "tool",
      toolName: "bash",
      risk: "command",
      repo: "aurora-api",
      args: { command: "pnpm test --filter rate-limit", background: true },
      result: {
        content: "Background verification completed: 3 tests passed.",
        details: { exitCode: 0, signal: null },
      },
    },
    {
      type: "assistant",
      text: "Rate limiting is in place on POST /bookings: a 60 second sliding window, 120 sustained requests per client key, and a 160 request burst allowance. The middleware already tracked per-key hits, so the change was a burst option plus wiring — all 3 tests pass in the background suite.\n\nThe limiter is in-process, so it counts per API replica rather than across the fleet. If festival on-sales need a fleet-wide cap, that needs shared state and is worth a separate change.",
    },
  ],
};

export const flakyDeploy: DemoConversation = {
  title: "Investigate flaky staging deploys",
  agentProfile: "coding",
  permissionRuleSetId: "supervised",
  ageHours: 26,
  children: [
    {
      name: "Staging readiness",
      profile: "explore",
      task: "Inspect staging readiness and cold start settings.",
      report:
        "The 5 second readiness budget is too short for cold starts at 500m CPU. Evidence: deploy/staging.tf and compose.yaml.",
    },
    {
      name: "Production comparison",
      profile: "explore",
      task: "Compare production and staging startup settings.",
      report:
        "Production uses 1000m CPU and starts within the same readiness budget. Evidence: deploy/production.tf.",
    },
  ],
  steps: [
    {
      type: "user",
      text: "Staging deploys fail roughly one run in four and then succeed on retry. Find out why.",
    },
    {
      type: "assistant",
      text: "I will look at the deploy definitions and compare staging with production, then check whether the failure correlates with replica counts.",
      thinking:
        "Intermittent failure that clears on retry usually means a readiness race or a resource ceiling rather than a broken manifest. Comparing staging and production definitions should show which one differs.",
    },
    {
      type: "tool",
      toolName: "read",
      risk: "read",
      repo: "aurora-infra",
      args: { path: "deploy/staging.tf" },
      result: {
        path: "deploy/staging.tf",
        content:
          'resource "aurora_service" "api" {\n  name     = "aurora-api"\n  replicas = 2\n  cpu      = "500m"\n}\n',
        lines: 10,
      },
    },
    {
      type: "agent_report",
      text: "Staging readiness · explore profile — staging readiness\n\nThe staging API service declares two replicas at 500m CPU while the readiness probe allows a 5 second startup budget. Cold starts in the compose build path routinely exceed that budget, so one replica is marked unhealthy and the deploy is rolled back.\n\nEvidence: deploy/staging.tf:2-5, compose.yaml:3-7.",
    },
    {
      type: "agent_report",
      text: "Production comparison · explore profile — production comparison\n\nProduction runs six replicas at 1000m CPU with the same probe budget. At that CPU allocation the startup path completes inside the budget, which is why the same manifest shape is stable in production.\n\nEvidence: deploy/production.tf:1-5.",
    },
    {
      type: "assistant",
      text: "Both children point at the same thing: the readiness budget is fine in production because startup is faster there, and too tight in staging because 500m CPU makes cold start slower than the probe allows.",
    },
    {
      type: "tool",
      toolName: "bash",
      risk: "command",
      repo: "aurora-infra",
      args: { command: "grep -rn 'readiness' deploy/" },
      result: {
        content:
          'deploy/staging.tf:12:  readiness_timeout = "5s"\ndeploy/production.tf:9:  readiness_timeout = "5s"\n',
        details: { exitCode: 0, signal: null },
      },
    },
    {
      type: "compaction",
      text: "Earlier investigation summarized: staging deploys fail intermittently because the 5 second readiness budget is shorter than cold start at 500m CPU; production is stable only because it runs at 1000m. Files inspected: deploy/staging.tf, deploy/production.tf, compose.yaml.",
    },
    {
      type: "assistant",
      text: "Two ways to fix it: raise the staging readiness budget to match real cold start, or raise staging CPU so cold start fits the existing budget. Raising the budget is cheaper and does not change what staging costs.",
    },
  ],
  branches: [
    {
      fromStep: 8,
      steps: [
        {
          type: "user",
          text: "Try the CPU route instead — I want staging to behave like production.",
        },
        {
          type: "assistant",
          text: "Raising staging to 1000m matches production startup behaviour, at roughly double the staging compute cost. That trade is worth naming before we commit to it.",
        },
        {
          type: "tool",
          toolName: "edit",
          risk: "workspace_write",
          repo: "aurora-infra",
          args: {
            path: "deploy/staging.tf",
            edits: [
              { oldText: 'cpu      = "500m"', newText: 'cpu      = "1000m"' },
            ],
          },
          result: {
            path: "deploy/staging.tf",
            details: {
              diff: '@@ -1,5 +1,5 @@\n resource "aurora_service" "api" {\n   name     = "aurora-api"\n   replicas = 2\n-  cpu      = "500m"\n+  cpu      = "1000m"\n }',
              operationCount: 1,
              dryRun: false,
            },
          },
        },
      ],
    },
    {
      fromStep: 8,
      steps: [
        {
          type: "user",
          text: "Raise the readiness budget instead and show me the diff.",
        },
        {
          type: "tool",
          toolName: "edit",
          risk: "workspace_write",
          repo: "aurora-infra",
          args: {
            path: "deploy/staging.tf",
            edits: [
              {
                oldText: 'readiness_timeout = "5s"',
                newText: 'readiness_timeout = "20s"',
              },
            ],
          },
          result: {
            path: "deploy/staging.tf",
            details: {
              diff: '@@ -10,7 +10,7 @@\n   health_check {\n     path = "/healthz"\n-    readiness_timeout = "5s"\n+    readiness_timeout = "20s"\n   }',
              operationCount: 1,
              dryRun: false,
            },
          },
        },
        {
          type: "tool",
          toolName: "launch",
          risk: "command",
          repo: "aurora-infra",
          args: { action: "start", name: "staging smoke" },
          result: {
            content:
              "The synthetic staging smoke launch completed successfully. 18 checks passed across 3 deploys.",
          },
        },
        {
          type: "assistant",
          text: "Readiness budget raised to 20 seconds in staging. The smoke launch ran three consecutive deploys without a rollback.",
        },
      ],
    },
    {
      fromStep: 5,
      steps: [
        {
          type: "user",
          text: "Before picking a fix — is the compose build path even the same one CI uses?",
        },
        {
          type: "assistant",
          text: "Checking. If CI builds a prebaked image and staging builds from source at deploy time, cold start is not comparable between them and the readiness budget is the wrong lever.",
        },
        {
          type: "tool",
          toolName: "read",
          risk: "read",
          repo: "aurora-infra",
          args: { path: "compose.yaml" },
          result: {
            content:
              'services:\n  api:\n    build: ../aurora-api\n    ports:\n      - "8080:8080"\n',
            lines: 9,
          },
        },
      ],
    },
  ],
};

export const designTokens: DemoConversation = {
  title: "Move the venue card onto design tokens",
  agentProfile: "coding",
  permissionRuleSetId: "supervised",
  ageHours: 50,
  steps: [
    {
      type: "user",
      text: "The venue card still hardcodes colours. Move it onto the token stylesheet.",
    },
    {
      type: "tool",
      toolName: "read",
      risk: "read",
      repo: "aurora-web",
      args: { path: "src/lib/tokens.css" },
      result: {
        path: "src/lib/tokens.css",
        content:
          ":root {\n  --surface: oklch(98% 0.01 250);\n  --surface-raised: oklch(100% 0 0);\n  --text: oklch(24% 0.02 250);\n  --accent: oklch(62% 0.16 250);\n}\n",
        lines: 6,
      },
    },
    {
      type: "tool",
      toolName: "edit",
      risk: "workspace_write",
      repo: "aurora-web",
      args: {
        path: "src/lib/VenueCard.svelte",
        edits: [
          {
            oldText: "background: #ffffff;",
            newText: "background: var(--surface-raised);",
          },
        ],
      },
      result: {
        path: "src/lib/VenueCard.svelte",
        details: {
          diff: "@@ -8,9 +8,9 @@\n .venue-card {\n-  background: #ffffff;\n-  color: #14181f;\n-  border: 1px solid #e3e7ee;\n+  background: var(--surface-raised);\n+  color: var(--text);\n+  border: 1px solid color-mix(in oklab, var(--text) 12%, transparent);\n }",
          operationCount: 3,
          dryRun: false,
        },
      },
    },
    {
      type: "assistant",
      text: "The venue card now reads surface, text, and accent from the token sheet, so it follows theme changes instead of pinning white.",
    },
  ],
};

export const planning: DemoConversation = {
  title: "Plan the fleet-wide rate limiter",
  agentProfile: "planning",
  permissionRuleSetId: "supervised",
  ageHours: 5,
  steps: [
    {
      type: "user",
      text: "Sketch what a fleet-wide rate limiter would take, without touching code yet.",
    },
    {
      type: "assistant",
      text: "With the Planning profile I can research and write the plan, but not edit the service. The shape is: shared counter store, a per-key sliding window in that store, and a fallback to the in-process limiter when the store is unreachable.",
    },
  ],
};

const RICH_REPLY = `## Limiter strategies for POST /bookings

Three options fit the festival on-sale pattern. In order of effort:

1. **Per-replica sliding window** — what the middleware does today; no new infrastructure.
2. **Shared counter store** — one cap across the fleet, at the cost of a new dependency.
3. **Edge rate limiting** — reject at the proxy before requests reach the API.

| Option | Fleet-wide cap | New infrastructure | Failure mode |
| --- | --- | --- | --- |
| Per-replica window | No | None | Cap scales with replica count |
| Shared counter store | Yes | Redis-compatible store | Falls back to per-replica |
| Edge limiting | Yes | Proxy rules | Coarse, keyed by IP only |

The current middleware only needs a burst option to cover short spikes:

\`\`\`ts
export const bookingLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  burst: 40,
});
\`\`\`

Requests are checked against the cap first:

\`\`\`mermaid
flowchart LR
  A[Client] --> B{Under the cap?}
  B -- yes --> C[Create booking]
  B -- no --> D[429 response]
\`\`\`

I would start with option 1 and revisit once the rollout shows real traffic.`;

export const limiterStrategies: DemoConversation = {
  title: "Compare limiter strategies for POST /bookings",
  agentProfile: "release-reviewer",
  permissionRuleSetId: "supervised",
  ageHours: 3,
  references: [
    {
      kind: "pull_request",
      repository: "aurora-demo/aurora-api",
      number: 42,
      relationship: "referenced",
    },
  ],
  steps: [
    {
      type: "user",
      text: "Before we merge PR #42, compare the realistic limiter strategies for POST /bookings.",
    },
    { type: "assistant", text: RICH_REPLY },
  ],
};

export const failedMigration: DemoConversation = {
  title: "Migrate venue photos to the new CDN",
  agentProfile: "coding",
  permissionRuleSetId: "supervised",
  ageHours: 4,
  outcome: "failed",
  steps: [
    {
      type: "user",
      text: "Move the venue photo URLs over to the new CDN host and update the cache headers.",
    },
    {
      type: "assistant",
      text: "I will start with the venue serializer, then update the asset helper.",
    },
  ],
};

export const runningBackfill: DemoConversation = {
  title: "Backfill the venue availability cache",
  agentProfile: "coding",
  permissionRuleSetId: "autonomous",
  ageHours: 0.2,
  outcome: "interrupted",
  steps: [
    {
      type: "user",
      text: "Backfill the availability cache for every venue, then report the hit rate.",
    },
    {
      type: "assistant",
      text: "Warming the cache venue by venue and checking hit rates as I go.",
    },
  ],
};

export const shortConversations: readonly DemoConversation[] = [
  {
    title: "Why is the availability endpoint slow?",
    agentProfile: "coding",
    permissionRuleSetId: "read_only",
    ageHours: 8,
    steps: [
      {
        type: "user",
        text: "GET /venues/availability takes about 900ms. Where does the time go?",
      },
      {
        type: "assistant",
        text: "It fans out one lookup per venue with no batching, so latency scales with the venue count rather than staying flat.",
      },
    ],
  },
  {
    title: "Tidy the compose build contexts",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 30,
    completed: true,
    steps: [
      {
        type: "user",
        text: "Pin the compose build contexts to relative paths.",
      },
      {
        type: "assistant",
        text: "Done — both services now build from sibling directories instead of absolute paths.",
      },
    ],
  },
  {
    title: "Empty state copy for the mobile booking list",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 74,
    completed: true,
    steps: [
      {
        type: "user",
        text: "The empty state reads oddly. Suggest better copy.",
      },
      {
        type: "assistant",
        text: '"No bookings today" is fine for staff; the ambiguous case is a filtered view with no results, which needs its own message.',
      },
    ],
  },
  {
    title: "Review the booking cancellation endpoint",
    agentProfile: "coding",
    permissionRuleSetId: "read_only",
    ageHours: 96,
    steps: [
      {
        type: "user",
        text: "Read the cancellation route and tell me what is missing.",
      },
      {
        type: "assistant",
        text: "Cancellation is not idempotent: a repeated request after a successful cancel returns a 500 rather than the prior result.",
      },
    ],
  },
  {
    title: "Add a staging smoke launch",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 120,
    steps: [
      {
        type: "user",
        text: "Set up a smoke check I can run after each staging deploy.",
      },
      {
        type: "assistant",
        text: "Added as a background task so its output is retained between runs instead of scrolling away.",
      },
    ],
  },
  {
    title: "Timezone handling in booking windows",
    agentProfile: "coding",
    permissionRuleSetId: "supervised",
    ageHours: 150,
    steps: [
      {
        type: "user",
        text: "Bookings near midnight land on the wrong day for some venues.",
      },
      {
        type: "assistant",
        text: "The window is computed in server local time rather than venue time, so venues east of the server roll over a day early.",
      },
    ],
  },
];
