/**
 * Entirely invented GitHub data, installed only in the capture browser.
 *
 * Mirrors the live pull request sync contracts: the client reads a repository
 * snapshot (`github.pr.snapshot.get`), declares demand with
 * `github.pr.watch.sync`, and loads per-PR detail sections on demand. Every
 * answer is a pure function of the request params, so no state is needed.
 *
 * Linked conversations are not faked here: the seeded Aurora conversations
 * carry real `aurora-demo/aurora-api#42` references that the PR pane matches.
 */
const VIEWER = "aurora-demo";
const REPOSITORY = "aurora-demo/aurora-api";
const REPOSITORY_URL = "https://github.com/aurora-demo/aurora-api";
const NOW = "2026-10-20T09:00:00Z";
const day = (days, hour = 10) =>
  new Date(Date.UTC(2026, 9, 20 - days, hour, 12)).toISOString();
const sha = (seed) => seed.repeat(40).slice(0, 40);
const BASE_SHA = sha("b");

const check = (name, status, conclusion, extra = {}) => ({
  name,
  status,
  conclusion,
  workflow: "CI",
  startedAt: day(0, 8),
  ...(conclusion ? { completedAt: day(0, 9) } : {}),
  ...extra,
});

function summarize(runs) {
  const passed = runs.filter((run) => run.conclusion === "SUCCESS").length;
  const failed = runs.filter((run) => run.conclusion === "FAILURE").length;
  const pending = runs.length - passed - failed;
  return {
    status: !runs.length
      ? "none"
      : failed
        ? "failing"
        : pending
          ? "pending"
          : "passing",
    total: runs.length,
    passed,
    failed,
    pending,
    runs,
  };
}

const CHECKS = {
  42: summarize([
    check("Unit tests", "COMPLETED", "SUCCESS", { required: true }),
    check("Type check", "COMPLETED", "SUCCESS", { required: true }),
    check("Lint", "COMPLETED", "FAILURE", {
      summary: "2 errors in src/middleware/rate-limit.ts",
    }),
    check("Build", "IN_PROGRESS", null),
    check("Preview deploy", "QUEUED", null),
  ]),
  41: summarize([
    check("Unit tests", "COMPLETED", "SUCCESS"),
    check("Type check", "COMPLETED", "SUCCESS"),
    check("Build", "COMPLETED", "SUCCESS"),
  ]),
  44: summarize([]),
};

const PRS = {
  42: {
    number: 42,
    title: "Add burst-aware rate limiting to bookings",
    state: "OPEN",
    isDraft: false,
    headRefName: "feat/rate-limiting",
    updatedAt: NOW,
    createdAt: day(2),
    author: VIEWER,
    commentCount: 2,
    additions: 48,
    deletions: 6,
    changedFiles: 3,
    headRefOid: sha("a"),
    labels: ["api", "ready for review"],
    reviewRequested: false,
    body: "## Summary\n\nAdd a configurable burst allowance to the booking limiter and apply it to `POST /bookings`.\n\n## Verification\n\n- Focused middleware tests pass\n- Existing booking validation is unchanged\n- Per-replica limits are documented for rollout",
    comments: [
      {
        id: "demo-comment-1",
        author: "mira-okafor",
        body: "Boundary coverage looks good. Keep the per-replica limitation in the rollout notes.",
        createdAt: day(1, 15),
      },
      {
        id: "demo-comment-2",
        author: VIEWER,
        body: "Added the note, and a follow-up issue tracks the fleet-wide cap.",
        createdAt: day(0, 7),
      },
    ],
    reviews: [
      {
        id: "demo-review-1",
        author: "mira-okafor",
        state: "APPROVED",
        body: "Ready for a staged rollout once lint is green.",
        submittedAt: day(1, 16),
      },
    ],
    overview: {
      mergeable: "MERGEABLE",
      mergeStateStatus: "UNSTABLE",
      reviewDecision: "APPROVED",
      behindBy: 0,
      reviewRequests: [{ login: "tomas-lindqvist" }],
    },
    commits: [
      ["Introduce a burst option on the rate limiter", day(2, 9), 22, 2],
      ["Apply the limiter to POST /bookings", day(1, 11), 8, 2],
      ["Cover burst boundaries in tests", day(1, 14), 24, 0],
      ["Document per-replica limits for rollout", day(0, 7), 4, 0],
    ],
    files: [
      ["src/middleware/rate-limit.ts", "modified", 18, 4],
      ["src/routes/bookings.ts", "modified", 6, 2],
      ["test/rate-limit.test.ts", "added", 24, 0],
    ],
  },
  41: {
    number: 41,
    title: "Keep booking windows timezone-aware",
    state: "OPEN",
    isDraft: false,
    headRefName: "fix/booking-timezones",
    updatedAt: day(0, 6),
    createdAt: day(3),
    author: "mira-okafor",
    commentCount: 0,
    additions: 24,
    deletions: 8,
    changedFiles: 2,
    headRefOid: sha("c"),
    labels: ["bug"],
    reviewRequested: true,
    body: "Booking windows were compared in server time. Store the venue timezone and compare in UTC.",
    comments: [],
    reviews: [],
    overview: {
      mergeable: "MERGEABLE",
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      behindBy: 2,
      reviewRequests: [{ login: VIEWER }],
    },
    commits: [
      ["Store the venue timezone with each window", day(3, 13), 14, 4],
      ["Compare booking windows in UTC", day(2, 10), 10, 4],
    ],
    files: [
      ["src/routes/bookings.ts", "modified", 12, 5],
      ["src/venues/windows.ts", "modified", 12, 3],
    ],
  },
  44: {
    number: 44,
    title: "Draft: shared counter store for fleet-wide limits",
    state: "OPEN",
    isDraft: true,
    headRefName: "spike/shared-limiter",
    updatedAt: day(1, 12),
    createdAt: day(1, 9),
    author: VIEWER,
    commentCount: 0,
    additions: 112,
    deletions: 0,
    changedFiles: 1,
    headRefOid: sha("d"),
    labels: ["spike"],
    reviewRequested: false,
    body: "Exploration only. Sketches a Redis-compatible counter adapter behind the existing limiter interface.",
    comments: [],
    reviews: [],
    overview: {
      mergeable: "UNKNOWN",
      mergeStateStatus: "DRAFT",
      reviewDecision: null,
      behindBy: 5,
      reviewRequests: [],
    },
    commits: [["Sketch a counter store adapter", day(1, 9), 112, 0]],
    files: [["src/middleware/counter-store.ts", "added", 112, 0]],
  },
};

const ORIGINAL = `export interface RateLimitOptions {
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
`;
const MODIFIED = `export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Extra requests allowed in a short spike before limiting starts. */
  burst?: number;
}

export function rateLimit(options: RateLimitOptions) {
  const hits = new Map<string, number[]>();
  const cap = options.max + (options.burst ?? 0);
  return (request: Request) => {
    const now = Date.now();
    const key = clientKey(request);
    const recent = (hits.get(key) ?? []).filter(
      (at) => now - at < options.windowMs,
    );
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= cap;
  };
}
`;

const prSummary = (pr) => ({
  number: pr.number,
  title: pr.title,
  url: `${REPOSITORY_URL}/pull/${pr.number}`,
  state: pr.state,
  isDraft: pr.isDraft,
  headRefName: pr.headRefName,
  baseRefName: "main",
  updatedAt: pr.updatedAt,
  author: pr.author,
  commentCount: pr.commentCount,
  additions: pr.additions,
  deletions: pr.deletions,
  headSha: pr.headRefOid,
  headRepository: REPOSITORY,
  labels: pr.labels,
  reviewRequested: pr.reviewRequested,
  checks: CHECKS[pr.number],
});

const prCore = (pr) => {
  const { checks, labels, reviewRequested, ...rest } = prSummary(pr);
  void checks;
  void labels;
  void reviewRequested;
  return {
    ...rest,
    createdAt: pr.createdAt,
    changedFiles: pr.changedFiles,
    headRefOid: pr.headRefOid,
    baseRefOid: BASE_SHA,
  };
};

const prConversation = (pr) => ({
  body: pr.body,
  comments: pr.comments,
  reviews: pr.reviews,
});

const prOverview = (pr) => ({
  mergeable: pr.overview.mergeable,
  mergeStateStatus: pr.overview.mergeStateStatus,
  reviewDecision: pr.overview.reviewDecision,
  viewerCanMergeAsAdmin: false,
  behindBy: pr.overview.behindBy,
  mergedAt: null,
  mergedBy: null,
  mergeCommitOid: null,
  closedAt: null,
  labels: pr.labels.map((name) => ({ name })),
  reviewRequests: pr.overview.reviewRequests,
  mergeSettings: { allowedMethods: ["squash", "merge", "rebase"] },
});

const prCommits = (pr) => ({
  commits: pr.commits.map(
    ([messageHeadline, authoredDate, additions, deletions], index) => {
      const oid = sha(`${pr.number}${index}`.padEnd(2, "e"));
      return {
        oid,
        abbrev: oid.slice(0, 7),
        messageHeadline,
        authoredDate,
        authorName: pr.author === VIEWER ? "Aurora Demo" : "Mira Okafor",
        authorLogin: pr.author,
        additions,
        deletions,
      };
    },
  ),
});

const prFiles = (pr) => ({
  files: pr.files.map(([path, status, additions, deletions]) => ({
    path,
    status,
    additions,
    deletions,
    changes: additions + deletions,
  })),
  totalCount: pr.files.length,
  truncated: false,
});

function snapshot(params) {
  return {
    projectId: params.projectId,
    repo: params.repo,
    revision: 1,
    status: "fresh",
    updatedAt: NOW,
    truncated: false,
    repositoryUrl: REPOSITORY_URL,
    viewer: VIEWER,
    retryAt: null,
    prs: Object.values(PRS).map(prSummary),
  };
}

const list = () => ({ prs: Object.values(PRS).map(prSummary) });

const issues = () => ({
  status: "fresh",
  refreshing: false,
  updatedAt: NOW,
  issues: [
    {
      number: 37,
      title: "Booking endpoint overwhelmed during festival on-sales",
      url: `${REPOSITORY_URL}/issues/37`,
      state: "OPEN",
      updatedAt: day(1),
      author: "mira-okafor",
    },
    {
      number: 39,
      title: "Track a fleet-wide booking cap",
      url: `${REPOSITORY_URL}/issues/39`,
      state: "OPEN",
      updatedAt: day(0, 7),
      author: VIEWER,
    },
  ],
});

/** Read methods only; mutations are never answered. */
const HANDLERS = {
  "github.status.get": () => ({
    available: true,
    authenticated: true,
    login: VIEWER,
  }),
  "github.pr.snapshot.get": snapshot,
  "github.pr.refresh": snapshot,
  "github.pr.watch.sync": () => ({ revision: 1 }),
  "github.pr.watch.clear": () => ({ revision: 1 }),
  "github.pr.expect": () => ({ accepted: true }),
  "github.pr.list": list,
  "github.pr.cached.list": () => ({
    status: "fresh",
    refreshing: false,
    updatedAt: NOW,
    result: list(),
  }),
  "github.issue.list": issues,
  "github.pr.initial.get": (params) => {
    const pr = PRS[params.number];
    return (
      pr && {
        core: prCore(pr),
        conversation: prConversation(pr),
        overview: prOverview(pr),
      }
    );
  },
  "github.pr.core.get": (params) =>
    PRS[params.number] && prCore(PRS[params.number]),
  "github.pr.conversation.get": (params) =>
    PRS[params.number] && prConversation(PRS[params.number]),
  "github.pr.overview.get": (params) =>
    PRS[params.number] && prOverview(PRS[params.number]),
  "github.pr.checks.get": (params) =>
    PRS[params.number] && { checks: CHECKS[params.number] },
  "github.pr.commits.get": (params) =>
    PRS[params.number] && prCommits(PRS[params.number]),
  "github.pr.files.get": (params) =>
    PRS[params.number] && prFiles(PRS[params.number]),
  "github.pr.file.diff.get": (params) => ({
    kind: "text",
    path: params.path,
    baseRefOid: BASE_SHA,
    headRefOid: PRS[params.number]?.headRefOid ?? PRS[42].headRefOid,
    original: params.path.endsWith("rate-limit.ts") ? ORIGINAL : "",
    modified: params.path.endsWith("rate-limit.ts")
      ? MODIFIED
      : `// ${params.path}\nexport {};\n`,
  }),
};

/** Result for a method, or undefined when the capture should not intercept it. */
export function demoGithubResult(method, params = {}) {
  return HANDLERS[method]?.(params ?? {});
}

export const DEMO_GITHUB_METHODS = Object.keys(HANDLERS);

export function demoGithubResponse(request) {
  if (
    request?.protocol !== "nerve" ||
    request.version !== 1 ||
    request.kind !== "request"
  )
    return;
  const method = request.data?.method;
  const result = demoGithubResult(method, request.data?.params);
  if (result === undefined) return;
  return {
    protocol: "nerve",
    version: 1,
    id: `demo-github-${request.id}`,
    kind: "response",
    ts: request.ts,
    source: request.target,
    target: request.source,
    replyTo: request.id,
    data: { ok: true, method, result },
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

export const DEMO_GITHUB_PR_NUMBERS = Object.keys(PRS).map(Number);
