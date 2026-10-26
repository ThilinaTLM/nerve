// Actual production provider mapping -> native index -> coordinator/policy.
// Acquisition is invented raw catalogs only. No pre-scored lexical stubs, real
// workspace discovery, network, user config/history, or command execution.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { SearchResult } from "@nervekit/native";
import { parseCompletionIntent } from "@nervekit/contracts/completions";
import { UnifiedCompletionService } from "../../src/domains/completions/unified-completion-service.js";
import { CompletionUsageStore } from "../../src/domains/completions/completion-usage-store.js";
import {
  completionUsageId,
  rankCompletionCandidates,
  rankCompletionGroups,
  type CompletionContext,
} from "../../src/domains/completions/completion-ranking-policy.js";
import type {
  CompletionDocument,
  CompletionSearchIndex,
} from "../../src/domains/completions/completion-provider.js";
import {
  completionJudgments,
  judgedPaths,
  rankingMetrics,
} from "./completion-judgments.js";
import {
  adversarialJudgments,
  adversarialPaths,
} from "./completion-adversarial-judgments.js";
import {
  syntheticProviders,
  syntheticScope,
  type SyntheticProviderOptions,
} from "./completion-synthetic-providers.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const quantiles = (times: number[]) => {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
  };
};
function expectedDocument(
  documents: readonly CompletionDocument[],
  expected: string,
): CompletionDocument {
  const labels: Readonly<Record<string, string>> = {
    "skill:aurora": "@skill:aurora",
    "pr:271": "https://synthetic.invalid/project/pull/271",
    "launch:beacon": "launch_synthetic",
    "agent:cobalt": "@agent:cobalt",
    "tool:web_search": "@tool:web_search",
  };
  const found = documents.find((document) =>
    labels[expected]
      ? document.item.label === labels[expected]
      : (document.kind === "file" || document.kind === "directory") &&
        document.item.info === expected,
  );
  if (!found)
    throw new Error(`Synthetic intended document missing: ${expected}`);
  return found;
}
async function scenario<T>(
  createIndex: () => Promise<CompletionSearchIndex>,
  options: SyntheticProviderOptions,
  context: CompletionContext,
  usage: { expected: string; count: number }[],
  action: (env: {
    service: UnifiedCompletionService;
    documents: CompletionDocument[];
    coldServiceMs: number;
    nativeResult: () => SearchResult | undefined;
    nativeTimes: number[];
    measureNative: (enabled: boolean) => void;
  }) => Promise<T>,
): Promise<T> {
  const fixture = syntheticProviders(options);
  const documents = await fixture.documents();
  const home = await mkdtemp(join(tmpdir(), "completion-judged-native-"));
  let service: UnifiedCompletionService | undefined;
  let mainPools: SearchResult[] = [];
  const nativeTimes: number[] = [];
  let measure = false;
  try {
    const history = new CompletionUsageStore(home, () => fixture.now);
    for (const entry of usage) {
      const document = expectedDocument(documents, entry.expected);
      for (let i = 0; i < entry.count; i++)
        await history.record(
          syntheticScope.projectId,
          completionUsageId(document.kind, document.id),
        );
    }
    const start = performance.now();
    service = new UnifiedCompletionService({
      home,
      providers: fixture.providers,
      now: () => fixture.now,
      context: () => context,
      authorize(scope) {
        if (
          scope.projectId !== syntheticScope.projectId ||
          scope.conversationId !== syntheticScope.conversationId
        )
          throw new Error("Foreign synthetic scope");
      },
      createIndex: async () => {
        const index = await createIndex();
        return {
          ...index,
          async query(input) {
            const begin = performance.now();
            const result = await index.query(input);
            if (measure) nativeTimes.push(performance.now() - begin);
            // Capture all category pools, excluding the identity-filtered seed supplement.
            if (!input.documentIds) mainPools.push(result);
            return result;
          },
        };
      },
    });
    const search = service.search.bind(service);
    service.search = async (input) => {
      mainPools = [];
      return search(input);
    };
    // Drain asynchronous synthetic cache snapshots, not remote network work.
    let ready = await service.search({ ...syntheticScope, q: "" });
    for (
      let i = 0;
      i < 4 && ready.sources.some((source) => source.status === "loading");
      i++
    ) {
      await turn();
      ready = await service.search({ ...syntheticScope, q: "" });
    }
    if (ready.sources.some((source) => source.status !== "fresh"))
      throw new Error(
        `Synthetic provider failed: ${JSON.stringify(ready.sources)}`,
      );
    const coldServiceMs = performance.now() - start;
    return await action({
      service,
      documents,
      coldServiceMs,
      nativeResult: () =>
        mainPools.length
          ? {
              revision: mainPools[0]!.revision,
              items: mainPools
                .flatMap((pool) => pool.items)
                .sort((a, b) => b.lexicalScore - a.lexicalScore),
            }
          : undefined,
      nativeTimes,
      measureNative: (enabled) => {
        measure = enabled;
      },
    });
  } finally {
    await service?.dispose();
    await rm(home, { recursive: true, force: true });
  }
}

export async function measureUnifiedJudgments(
  createIndex: () => Promise<CompletionSearchIndex>,
  rounds = 9,
) {
  const paths = [...judgedPaths, ...adversarialPaths];
  for (let i = 0; i < 2000; i++)
    paths.push(`synthetic/module-${i}/src/controller-${i}.ts`);
  const lexical = await scenario(
    createIndex,
    { paths, allSources: true },
    {},
    [],
    async ({
      service,
      documents,
      coldServiceMs,
      nativeTimes,
      measureNative,
      nativeResult,
    }) => {
      const results = [];
      let sessionDiagnostics;

      const queries = [...completionJudgments, ...adversarialJudgments];
      for (const [i, judgment] of queries.entries()) {
        const expected = expectedDocument(documents, judgment.expected);
        const response = await service.search({
          ...syntheticScope,
          q: judgment.query,
        });
        if (judgment.query === "session.ts") {
          const native = nativeResult()!;
          const candidates = native.items.map((match) => {
            const document = documents.find((entry) => entry.id === match.id)!;
            return {
              ...document.item,
              documentId: document.id,
              sortScore: match.lexicalScore + (document.stateBoost ?? 0),
              scoreFactors: {
                lexical: match.lexicalScore,
                context: 0,
                usage: 0,
                state: document.stateBoost ?? 0,
              },
            };
          });
          const final = rankCompletionCandidates(candidates, {}, new Map());
          if (
            JSON.stringify(
              rankCompletionGroups(
                candidates,
                {},
                new Map(),
                parseCompletionIntent(judgment.query),
                21,
              ).items.map((item) => item.documentId),
            ) !== JSON.stringify(response.items.map((item) => item.documentId))
          )
            throw new Error("Diagnostic ranking diverged from service");
          const describe = (item: (typeof final)[number]) => ({
            id: item.documentId,
            kind: item.kind,
            path: item.info,
            lexicalScore: item.scoreFactors?.lexical,
            finalScore: item.sortScore,
            factors: item.scoreFactors,
          });
          sessionDiagnostics = {
            query: judgment.query,
            intendedId: expected.id,
            candidateCount: native.items.length,
            matchedFileCount: candidates.filter(
              (item) => item.kind === "file" || item.kind === "directory",
            ).length,
            visible: response.items.map((item) => ({
              id: item.documentId,
              kind: item.kind,
            })),
            groups: response.groups,
            nativeTop10: native.items.slice(0, 10).map((match) => ({
              ...describe(final.find((item) => item.documentId === match.id)!),
              fieldMatches: match.matches,
            })),
            finalTop10: final.slice(0, 10).map(describe),
          };
        }
        const rank =
          response.items.findIndex((item) => item.documentId === expected.id) +
          1;
        results.push({
          ...judgment,
          set: i < completionJudgments.length ? "original" : "adversarial",
          rank,
        });
      }
      const coverageJudgments = [
        { query: "tool:read", label: "@tool:read", kind: "tool" },
        { query: "tool:web_search", label: "@tool:web_search", kind: "tool" },
        { query: "skill:aurora", label: "@skill:aurora", kind: "skill" },
        {
          query: "profile:cobalt",
          label: "@agent:cobalt",
          kind: "agent_profile",
        },
        {
          query: "agent:session-worker",
          label: "@agent:conv_child_synthetic",
          kind: "subagent",
        },
        {
          query: "launch:beacon-build",
          label: "@launch:launchdef_synthetic",
          kind: "launch_definition",
        },
        { query: "launch:beacon", label: "launch_synthetic", kind: "launch" },
        {
          query: "pr:271 aurora",
          label: "https://synthetic.invalid/project/pull/271",
          kind: "pull_request",
        },
        {
          query: "issue:42 rollover",
          label: "https://synthetic.invalid/project/issues/42",
          kind: "issue",
        },
      ];
      const coverage = [];
      for (const judgment of coverageJudgments) {
        const expected = documents.find(
          (document) =>
            document.item.label === judgment.label &&
            document.kind === judgment.kind,
        )!;
        if (!expected)
          throw new Error(`Missing provider fixture ${judgment.label}`);
        const response = await service.search({
          ...syntheticScope,
          q: judgment.query,
        });
        const selected = response.items.find(
          (item) => item.documentId === expected.id,
        );
        coverage.push({
          ...judgment,
          rank:
            response.items.findIndex(
              (item) => item.documentId === expected.id,
            ) + 1,
          enabled: selected?.enabled,
          available: selected?.available,
          factors: selected?.scoreFactors,
        });
      }
      const times: number[] = [];
      measureNative(true);
      for (let round = 0; round < rounds; round++)
        for (const judgment of [...queries, ...coverageJudgments]) {
          const begin = performance.now();
          await service.search({
            ...syntheticScope,
            q: judgment.query,
          });
          times.push(performance.now() - begin);
        }
      measureNative(false);
      return {
        sessionDiagnostics,
        original: rankingMetrics(
          results
            .filter((result) => result.set === "original")
            .map((result) => result.rank),
        ),
        adversarial: rankingMetrics(
          results
            .filter((result) => result.set === "adversarial")
            .map((result) => result.rank),
        ),
        providerCoverage: {
          metrics: rankingMetrics(coverage.map((result) => result.rank)),
          results: coverage,
        },
        results,
        coldSyntheticServiceMs: coldServiceMs,
        documentCount: documents.length,
        warmServiceQueryMs: quantiles(times),
        warmNativeCallMs: quantiles(nativeTimes),
      };
    },
  );
  const deepPaths = Array.from(
    { length: 16 },
    (_, i) => `variants/${"level/".repeat(i)}session.ts`,
  );
  const siblingPaths = Array.from(
    { length: 16 },
    (_, i) => `variants/${"x".repeat(i + 1)}/session.ts`,
  );
  const cases: {
    name: string;
    options: SyntheticProviderOptions;
    query?: string;
    expected: string;
    context?: CompletionContext;
    usage?: { expected: string; count: number }[];
  }[] = [
    {
      name: "cross-kind lexical competition without signals",
      options: { paths: ["src/auth/session.ts"], crossKind: true },
      expected: "src/auth/session.ts",
    },
    {
      name: "running launch usage competes with same-name file and PR",
      options: { paths: ["src/auth/session.ts"], crossKind: true },
      expected: "launch:beacon",
      usage: [{ expected: "launch:beacon", count: 4 }],
    },
    {
      name: "PR usage competes with same-name file and launch",
      options: { paths: ["src/auth/session.ts"], crossKind: true },
      expected: "pr:271",
      usage: [{ expected: "pr:271", count: 4 }],
    },
    {
      name: "edited-file context competes with running-launch usage",
      options: { paths: ["src/auth/session.ts"], crossKind: true },
      expected: "src/auth/session.ts",
      context: { editedPaths: ["src/auth/session.ts"] },
      usage: [{ expected: "launch:beacon", count: 4 }],
    },
    {
      name: "context rescues lexical rank twelve",
      options: { paths: deepPaths },
      expected: deepPaths[11]!,
      context: { editedPaths: [deepPaths[11]!] },
    },
    {
      name: "usage rescues lexical rank sixteen",
      options: { paths: deepPaths },
      expected: deepPaths[15]!,
      usage: [{ expected: deepPaths[15]!, count: 100 }],
    },
    {
      name: "bounded usage cannot defeat a substantially stronger lexical match",
      options: {
        paths: ["src/auth/session.ts"],
        crossKind: true,
        weakCompetition: true,
      },
      expected: "src/auth/session.ts",
      usage: [{ expected: "launch:beacon", count: 100 }],
    },
    {
      name: "sibling basename context rescues a candidate beyond eight",
      options: { paths: siblingPaths },
      query: "sess",
      expected: siblingPaths[9]!,
      context: { openPaths: [siblingPaths[9]!] },
    },
  ];
  const policyResults = [];
  for (const judgment of cases) {
    policyResults.push(
      await scenario(
        createIndex,
        judgment.options,
        judgment.context ?? {},
        judgment.usage ?? [],
        async ({ service, documents, nativeResult }) => {
          const expected = expectedDocument(documents, judgment.expected);
          const response = await service.search({
            ...syntheticScope,
            q: judgment.query ?? "session",
          });
          const native = nativeResult()!;
          return {
            name: judgment.name,
            rank:
              response.items.findIndex(
                (item) => item.documentId === expected.id,
              ) + 1,
            lexicalRank:
              native.items.findIndex((item) => item.id === expected.id) + 1,
            expected: judgment.expected,
            candidates: response.items.map((item) => ({
              label: item.label,
              kind: item.kind,
              factors: item.scoreFactors,
              score: item.sortScore,
            })),
          };
        },
      ),
    );
  }
  return {
    synthetic: true,
    acquisition: "invented raw catalogs through production providers",
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    lexical,
    actualNativePolicy: {
      metrics: rankingMetrics(policyResults.map((result) => result.rank)),
      results: policyResults,
    },
  };
}

/** Correctness only: actual initial @/empty-prefix UI, no latency evidence. */
export async function emptyCompletionEvidence(
  createIndex: () => Promise<CompletionSearchIndex>,
) {
  const wanted = "src/zzz-session.ts";
  const queries = [
    "",
    "@",
    "@file:",
    "@tool:",
    "@launch:",
    "@agent:",
    "@profile:",
    "@skill:",
    "@pr:",
    "@issue:",
  ];
  const run = (paths: string[], wantedPath = wanted) =>
    scenario(
      createIndex,
      { paths, allSources: true },
      { editedPaths: [wantedPath] },
      [
        { expected: wantedPath, count: 4 },
        { expected: "tool:web_search", count: 4 },
      ],
      async ({ service, documents, nativeResult }) => {
        const wantedId = expectedDocument(documents, wantedPath).id;
        const results = [];
        for (const query of queries) {
          const response = await service.search({
            ...syntheticScope,
            q: query,
          });
          const native = nativeResult()!;
          results.push({
            query,
            nativeCount: native.items.length,
            allLexicalZero:
              native.items.every((item) => item.lexicalScore === 0) &&
              response.items.every((item) => item.scoreFactors?.lexical === 0),
            nativeIds: native.items.map((item) => item.id),
            nativeFileIds: native.items
              .filter((item) => {
                const kind = documents.find(
                  (document) => document.id === item.id,
                )!.kind;
                return kind === "file" || kind === "directory";
              })
              .map((item) => item.id),
            groups: response.groups,
            matchedCounts: Object.fromEntries(
              [...new Set(documents.map((document) => document.kind))].map(
                (kind) => [
                  kind,
                  native.items.filter(
                    (item) =>
                      documents.find((document) => document.id === item.id)!
                        .kind === kind,
                  ).length,
                ],
              ),
            ),
            nativeKinds: [
              ...new Set(
                native.items.map(
                  (item) =>
                    documents.find((document) => document.id === item.id)!.kind,
                ),
              ),
            ],
            visible: response.items.map((item) => ({
              id: item.documentId,
              path: item.info,
              label: item.label,
              kind: item.kind,
              factors: item.scoreFactors,
              score: item.sortScore,
            })),
          });
        }
        return {
          documentCount: documents.length,
          fileDocumentCount: documents.filter(
            (document) =>
              document.kind === "file" || document.kind === "directory",
          ).length,
          wantedId,
          results,
        };
      },
    );
  const crowdedPaths = [
    ...Array.from({ length: 128 }, (_, i) => `src/module-${i}/session.ts`),
    ...Array.from(
      { length: 80 },
      (_, i) => `modules/dir-${String(i).padStart(3, "0")}/src`,
    ),
  ];
  const longWanted = "variants/longer-context/path/to/recent/session.ts";
  return {
    withinPool: await run([
      wanted,
      "src/handler.ts",
      "tests/session.ts",
      "feature/src",
    ]),
    denseWithinPool: await run([
      wanted,
      ...Array.from({ length: 40 }, (_, i) => `src/module-${i}/session.ts`),
      ...Array.from({ length: 4 }, (_, i) => `modules/dir-${i}/src`),
    ]),
    crowded: await run([wanted, ...crowdedPaths]),
    beyondMain: await run([longWanted, ...crowdedPaths], longWanted),
  };
}
