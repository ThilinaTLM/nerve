// Invented ambiguous judgments, never user data. Kept separate so the original
// 56-query baseline is reproducible unchanged. Expectations precede measurement.
import type {
  CompletionContext,
  CompletionRankCandidate,
} from "../../src/domains/completions/completion-ranking-policy.js";
import type { CompletionJudgment } from "./completion-judgments.js";

export const adversarialPaths = [
  "src/auth/session.ts",
  "tests/auth/session.ts",
  "generated/auth/session.ts",
  "docs/auth/session.ts",
  "src/auth/session.test.ts",
  "src/session.ts",
  "src/auth/session/manager.ts",
  "src/auth/session/session.ts",
  "src/auth/client/session.ts",
  "src/auth/server/session.ts",
  "src/billing/session.ts",
  "packages/client/src/auth/session.ts",
  "packages/server/src/auth/session.ts",
  "src/session/auth.ts",
  "src/config.ts",
  "src/config/settings.ts",
  "tests/config/settings.ts",
  "generated/config/settings.ts",
  "docs/config/settings.ts",
  "src/config/config.ts",
  "src/checkout.ts",
  "src/checkout/handler.ts",
  "tests/checkout.ts",
  "src/日本語/session.ts",
  "src/café/session.ts",
  "tests/café/session.ts",
];
export const adversarialJudgments: CompletionJudgment[] = [
  {
    query: "session.ts",
    expected: "src/auth/session.ts",
    category: "confusable",
  },
  {
    query: "auth/session",
    expected: "src/auth/session.ts",
    category: "confusable",
  },
  {
    query: "tests/auth/session",
    expected: "tests/auth/session.ts",
    category: "confusable",
  },
  {
    query: "generated auth session",
    expected: "generated/auth/session.ts",
    category: "multi-term",
  },
  {
    query: "docs auth sess",
    expected: "docs/auth/session.ts",
    category: "multi-term",
  },
  {
    query: "packages cli auth sess",
    expected: "packages/client/src/auth/session.ts",
    category: "multi-term",
  },
  {
    query: "packages/server/auth/sess",
    expected: "packages/server/src/auth/session.ts",
    category: "partial-path",
  },
  {
    query: "auth client sess",
    expected: "src/auth/client/session.ts",
    category: "multi-term",
  },
  {
    query: "auth/server/sess",
    expected: "src/auth/server/session.ts",
    category: "partial-path",
  },
  {
    query: "auth/session/man",
    expected: "src/auth/session/manager.ts",
    category: "parent-intent",
  },
  {
    query: "session/auth",
    expected: "src/session/auth.ts",
    category: "parent-intent",
  },
  { query: "config", expected: "src/config.ts", category: "basename-intent" },
  {
    query: "config/settings",
    expected: "src/config/settings.ts",
    category: "parent-intent",
  },
  {
    query: "tests config sett",
    expected: "tests/config/settings.ts",
    category: "multi-term",
  },
  {
    query: "generated/config/sett",
    expected: "generated/config/settings.ts",
    category: "partial-path",
  },
  {
    query: "checkout",
    expected: "src/checkout.ts",
    category: "basename-intent",
  },
  {
    query: "checkout/hand",
    expected: "src/checkout/handler.ts",
    category: "parent-intent",
  },
  {
    query: "café sess",
    expected: "src/café/session.ts",
    category: "confusable",
  },
  {
    query: "tests café sess",
    expected: "tests/café/session.ts",
    category: "multi-term",
  },
];

// Native-score stubs test final POLICY only, not cross-kind lexical quality.
// New typed-native integration must additionally judge actual lexical output.
export type PolicyJudgment = {
  name: string;
  pool: CompletionRankCandidate[];
  expectedId: string;
  context?: CompletionContext;
  usage?: { kind: string; id: string; count: number }[];
};
const crossKindPool: CompletionRankCandidate[] = [
  {
    documentId: "session",
    label: "session",
    info: "src/auth/session.ts",
    kind: "file",
    sortScore: 1000,
  },
  { documentId: "session", label: "session", kind: "launch", sortScore: 980 },
  {
    documentId: "session",
    label: "session",
    kind: "pull_request",
    sortScore: 960,
  },
];
const deepPool: CompletionRankCandidate[] = Array.from(
  { length: 16 },
  (_, i) => ({
    documentId: `session-${i}`,
    label: `@duplicate-${i}/session.ts`,
    info: `duplicate-${i}/session.ts`,
    kind: "file",
    sortScore: 1000 - i * 10,
  }),
);
export const policyJudgments: PolicyJudgment[] = [
  {
    name: "equal source identity uses lexical order without signals",
    pool: crossKindPool,
    expectedId: "file:session",
  },
  {
    name: "launch usage does not leak to same-ID file or PR",
    pool: crossKindPool,
    usage: [{ kind: "launch", id: "session", count: 4 }],
    expectedId: "launch:session",
  },
  {
    name: "PR usage does not leak to same-ID launch",
    pool: crossKindPool,
    usage: [{ kind: "pull_request", id: "session", count: 4 }],
    expectedId: "pull_request:session",
  },
  {
    name: "file conversation context competes with launch usage",
    pool: crossKindPool,
    context: { editedPaths: ["src/auth/session.ts"] },
    usage: [{ kind: "launch", id: "session", count: 4 }],
    expectedId: "file:session",
  },
  {
    name: "context rescues lexical rank twelve",
    pool: deepPool,
    context: { editedPaths: ["duplicate-11/session.ts"] },
    expectedId: "file:session-11",
  },
  {
    name: "usage rescues lexical rank sixteen",
    pool: deepPool,
    usage: [{ kind: "file", id: "session-15", count: 100 }],
    expectedId: "file:session-15",
  },
  {
    name: "bounded usage cannot defeat clearly stronger lexical match",
    pool: [
      { ...crossKindPool[0]!, sortScore: 3000 },
      ...crossKindPool.slice(1),
    ],
    usage: [{ kind: "launch", id: "session", count: 100 }],
    expectedId: "file:session",
  },
  {
    name: "same-basename sibling context is exact-path scoped",
    pool: deepPool,
    context: { openPaths: ["duplicate-9/session.ts"] },
    expectedId: "file:session-9",
  },
];
