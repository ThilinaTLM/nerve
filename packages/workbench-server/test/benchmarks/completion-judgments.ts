// Entirely invented corpus; never reads a workspace or user history.
export type CompletionJudgment = {
  query: string;
  expected: string;
  category:
    | "filename"
    | "partial-path"
    | "ancestor-directory"
    | "unicode"
    | "typed-intent"
    | "confusable"
    | "multi-term"
    | "parent-intent"
    | "basename-intent";
};
const modules = [
  "aurora",
  "beacon",
  "cobalt",
  "delta",
  "ember",
  "fjord",
  "garnet",
  "harbor",
];
export const judgedPaths = modules.flatMap((name) => [
  `packages/${name}/src/${name}-controller.ts`,
  `packages/${name}/src/config/settings.ts`,
  `packages/${name}/test/${name}-controller.test.ts`,
  `docs/${name}/overview.md`,
  `packages/${name}/src`,
]);
judgedPaths.push(
  "src/日本語/検索.ts",
  "src/café/résumé.ts",
  "src/🪴/garden.ts",
  "src/Ångström/mesure.ts",
);
export const completionJudgments: CompletionJudgment[] = modules.flatMap(
  (name) =>
    [
      {
        query: `${name}-controller.ts`,
        expected: `packages/${name}/src/${name}-controller.ts`,
        category: "filename",
      },
      {
        query: `${name}/src/${name}`,
        expected: `packages/${name}/src/${name}-controller.ts`,
        category: "partial-path",
      },
      {
        query: `${name}/src/config`,
        expected: `packages/${name}/src/config/settings.ts`,
        category: "ancestor-directory",
      },
      {
        query: `${name} overview`,
        expected: `docs/${name}/overview.md`,
        category: "ancestor-directory",
      },
      {
        query: `file:${name}-controller.ts`,
        expected: `packages/${name}/src/${name}-controller.ts`,
        category: "typed-intent",
      },
      {
        query: `${name}/src/`,
        expected: `packages/${name}/src`,
        category: "ancestor-directory",
      },
    ] as CompletionJudgment[],
);
completionJudgments.push(
  { query: "検索", expected: "src/日本語/検索.ts", category: "unicode" },
  { query: "résumé", expected: "src/café/résumé.ts", category: "unicode" },
  { query: "🪴/garden", expected: "src/🪴/garden.ts", category: "unicode" },
  {
    query: "Ångström/mes",
    expected: "src/Ångström/mesure.ts",
    category: "unicode",
  },
  { query: "skill:aurora", expected: "skill:aurora", category: "typed-intent" },
  { query: "pr:271", expected: "pr:271", category: "typed-intent" },
  {
    query: "launch:beacon",
    expected: "launch:beacon",
    category: "typed-intent",
  },
  { query: "agent:cobalt", expected: "agent:cobalt", category: "typed-intent" },
);

export function rankingMetrics(ranks: readonly number[]) {
  const count = ranks.length;
  return {
    count,
    top1: count ? ranks.filter((rank) => rank === 1).length / count : 0,
    top3: count
      ? ranks.filter((rank) => rank > 0 && rank <= 3).length / count
      : 0,
    mrr: count
      ? ranks.reduce((sum, rank) => sum + (rank > 0 ? 1 / rank : 0), 0) / count
      : 0,
  };
}
