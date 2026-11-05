/**
 * How each workspace package runs its unit tests, as data. Focused test
 * selection reads this table instead of pattern-matching `package.json`
 * scripts; `test/test-runners.test.ts` asserts the table agrees with every
 * package's real `test` script, so a script that drifts fails loudly there.
 */
export interface TestRunner {
  /** The package's exact `test` script. */
  script: string;
  /** Executable used for selected files (`pnpm --filter <pkg> exec <command> --test ...`). */
  command: "tsx" | "node";
  /** Extra runner flags that must accompany a file selection. */
  options: string[];
  /** Package-relative globs of the test files the script covers. */
  globs: string[];
  /** Test-file suffix covered (`.test.ts` or `.test.mjs`). */
  suffix: ".test.ts" | ".test.mjs";
}

const tsxScript = (globs: string[], options: string[] = []) =>
  `tsx --test${options.length ? ` ${options.join(" ")}` : ""} ${globs.map((glob) => `"${glob}"`).join(" ")}`;

function tsxRunner(
  globs: string[],
  {
    options = [],
    suffix = ".test.ts",
    script,
  }: {
    options?: string[];
    suffix?: TestRunner["suffix"];
    script?: string;
  } = {},
): TestRunner {
  return {
    script: script ?? tsxScript(globs, options),
    command: "tsx",
    options,
    globs,
    suffix,
  };
}

const defaultGlobs = ["test/**/*.test.ts"];

export const TEST_RUNNERS: ReadonlyMap<string, TestRunner> = new Map([
  ["@nervekit/contracts", tsxRunner(defaultGlobs)],
  ["@nervekit/protocol", tsxRunner(defaultGlobs)],
  ["@nervekit/harness", tsxRunner(defaultGlobs)],
  ["@nervekit/skills", tsxRunner(defaultGlobs)],
  ["@nervekit/desktop-shell", tsxRunner(defaultGlobs)],
  ["@nervekit/conversation-core", tsxRunner(["src/**/*.test.ts"])],
  [
    "@nervekit/native",
    tsxRunner(defaultGlobs, {
      script: `${tsxScript(defaultGlobs)} && pnpm test:native`,
    }),
  ],
  ["@nervekit/tools", tsxRunner(["test/**/*.test.ts", "src/**/*.test.ts"])],
  ["@nervekit/ui-kit", tsxRunner(["src/**/!(*.svelte).test.ts"])],
  [
    "@nervekit/website",
    tsxRunner(["scripts/**/*.test.mjs"], { suffix: ".test.mjs" }),
  ],
  [
    // `node scripts/run-tests.mjs` globs these and runs them under tsx --test.
    "@nervekit/workbench-app",
    tsxRunner(["src/**/*.test.ts", "scripts/**/*.test.ts"], {
      script: "node scripts/run-tests.mjs",
    }),
  ],
  [
    "@nervekit/workbench-server",
    tsxRunner(
      [
        "test/**/*.test.ts",
        "src/{adapters,app,core-host,domains}/**/*.test.ts",
        "src/infrastructure/{configuration,events,storage-bootstrap}/**/*.test.ts",
        "src/infrastructure/process-host/!(port-inspector).test.ts",
      ],
      { options: ["--test-concurrency=1"] },
    ),
  ],
]);
