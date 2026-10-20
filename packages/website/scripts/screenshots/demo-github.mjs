/** Entirely invented GitHub data, installed only in the capture browser. */
const updatedAt = "2026-10-20T09:00:00Z";
const checks = {
  status: "passing",
  total: 3,
  passed: 3,
  failed: 0,
  pending: 0,
  runs: ["Unit tests", "Type check", "Build"].map((name) => ({
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
  })),
};
const summary = {
  number: 42,
  title: "Add burst-aware rate limiting to bookings",
  url: "https://github.com/aurora-demo/aurora-api/pull/42",
  state: "OPEN",
  isDraft: false,
  headRefName: "feat/rate-limiting",
  baseRefName: "main",
  updatedAt,
  author: "aurora-demo",
  commentCount: 1,
  additions: 48,
  deletions: 6,
  checks,
};
const core = {
  ...summary,
  createdAt: updatedAt,
  changedFiles: 3,
  headRefOid: "a".repeat(40),
  baseRefOid: "b".repeat(40),
  headRepository: "aurora-demo/aurora-api",
};
const conversation = {
  body: "## Summary\n\nAdd a configurable burst allowance to the booking limiter and apply it to POST /bookings.\n\n## Verification\n\n- Focused middleware tests pass\n- Existing booking validation is unchanged\n- Per-replica limits are documented for rollout",
  comments: [
    {
      id: "demo-comment",
      author: "aurora-reviewer",
      body: "Boundary coverage looks good. Keep the per-replica limitation in the rollout notes.",
      createdAt: updatedAt,
    },
  ],
  reviews: [
    {
      id: "demo-review",
      author: "aurora-reviewer",
      state: "APPROVED",
      body: "Ready for a staged rollout.",
      submittedAt: updatedAt,
    },
  ],
};
const overview = {
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  behindBy: 0,
  mergedAt: null,
  mergedBy: null,
  mergeCommitOid: null,
  closedAt: null,
  labels: [{ name: "api" }, { name: "ready for review" }],
  reviewRequests: [],
  mergeSettings: { allowedMethods: ["squash", "merge", "rebase"] },
};
export const DEMO_GITHUB_RESULTS = {
  "github.status.get": {
    available: true,
    authenticated: true,
    login: "aurora-demo",
  },
  "github.pr.heads.list": {
    repository: "aurora-demo/aurora-api",
    prs: [{ ...summary, headRepository: core.headRepository }],
  },
  "github.pr.list": {
    prs: [
      summary,
      {
        ...summary,
        number: 41,
        title: "Keep booking windows timezone-aware",
        headRefName: "fix/booking-timezones",
        additions: 24,
        deletions: 8,
      },
    ],
  },
  "github.pr.initial.get": { core, conversation, overview },
  "github.pr.core.get": core,
  "github.pr.conversation.get": conversation,
  "github.pr.overview.get": overview,
  "github.pr.checks.get": { checks },
  "github.pr.commits.get": {
    commits: [
      {
        oid: core.headRefOid,
        abbrev: "aaaaaaa",
        messageHeadline: summary.title,
        authoredDate: updatedAt,
        authorName: "Aurora Demo",
      },
    ],
  },
  "github.pr.files.get": {
    files: [
      {
        path: "src/middleware/rate-limit.ts",
        status: "modified",
        additions: 18,
        deletions: 4,
        changes: 22,
      },
      {
        path: "src/routes/bookings.ts",
        status: "modified",
        additions: 6,
        deletions: 2,
        changes: 8,
      },
      {
        path: "test/rate-limit.test.ts",
        status: "added",
        additions: 24,
        deletions: 0,
        changes: 24,
      },
    ],
    totalCount: 3,
    truncated: false,
  },
};

export function demoGithubResponse(request) {
  if (
    request?.protocol !== "nerve" ||
    request.version !== 1 ||
    request.kind !== "request"
  )
    return;
  const result = DEMO_GITHUB_RESULTS[request.data?.method];
  if (!result) return;
  return {
    protocol: "nerve",
    version: 1,
    id: `demo-github-${request.id}`,
    kind: "response",
    ts: request.ts,
    source: request.target,
    target: request.source,
    replyTo: request.id,
    data: { ok: true, method: request.data.method, result },
  };
}

/** Advertise the fictional remote without adding one to the local repositories. */
export function demoGithubRepositoryHints(message) {
  if (Array.isArray(message)) return message.map(demoGithubRepositoryHints);
  if (!message || typeof message !== "object") return message;
  const result = Object.fromEntries(
    Object.entries(message).map(([key, value]) => [
      key,
      demoGithubRepositoryHints(value),
    ]),
  );
  if (result.isRepo === true && result.name === "aurora-api") {
    result.hasRemote = true;
    result.hasGithubRemote = true;
  }
  return result;
}
