import { extname } from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".rs",
  ".svelte",
  ".ts",
  ".tsx",
]);

const GENERATED_SEGMENTS = [
  "/.astro/",
  "/.svelte-kit/",
  "/.vite/",
  "/build/",
  "/dist/",
  "/node_modules/",
  "/prebuilds/",
  "/release/",
  "/target/",
];

export function analyzeCodeQuality(inventory) {
  const packages = new Map();
  const largeFiles = [];
  const signals = {
    eslintDisable: [],
    tsDirective: [],
    unsafeDoubleAssertion: [],
  };

  for (const file of [...inventory.files].sort()) {
    if (!isSourceFile(file) || isGenerated(file)) continue;
    const text = inventory.read(file);
    const lineCount = countLines(text);
    const packageName = ownerFor(file);
    const kind = isTestFile(file) ? "test" : "production";
    const entry = packages.get(packageName) ?? emptyPackageSummary(packageName);
    entry[kind].files += 1;
    entry[kind].lines += lineCount;
    packages.set(packageName, entry);

    if (kind === "production" && lineCount > 800) {
      largeFiles.push({ file, lines: lineCount });
    }
    collectMatches(signals.eslintDisable, file, text, /eslint-disable/g);
    collectMatches(
      signals.tsDirective,
      file,
      text,
      /@ts-(?:ignore|expect-error)/g,
    );
    collectMatches(
      signals.unsafeDoubleAssertion,
      file,
      text,
      /\bas\s+unknown\s+as\b/g,
    );
  }

  const testCommands = [];
  for (const file of [...inventory.files].sort()) {
    if (!/^packages\/[^/]+\/package\.json$/.test(file)) continue;
    const manifest = JSON.parse(inventory.read(file));
    if (typeof manifest.scripts?.test === "string") {
      testCommands.push({
        package: manifest.name,
        command: manifest.scripts.test,
      });
    }
  }

  return {
    packages: [...packages.values()].sort((left, right) =>
      left.package.localeCompare(right.package),
    ),
    largeFiles: largeFiles.sort(
      (left, right) =>
        right.lines - left.lines || left.file.localeCompare(right.file),
    ),
    signals,
    testCommands,
    notes: [
      "Counts include tracked and non-ignored untracked source files only.",
      "Production and test code are reported separately; generated/build artifacts are excluded.",
      "Lint directives and type assertions are syntactic review signals, not defect or quality scores.",
      "Coverage and runtime behavior cannot be inferred from file or line counts.",
    ],
  };
}

export function renderCodeQualityReport(report) {
  const lines = [
    "# Code quality inventory",
    "",
    "## Package source inventory",
    "",
    "| Package | Production files | Production lines | Test files | Test lines |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...report.packages.map(
      (entry) =>
        `| ${entry.package} | ${entry.production.files} | ${entry.production.lines} | ${entry.test.files} | ${entry.test.lines} |`,
    ),
    "",
    "## Large production files (>800 lines)",
    "",
    ...(report.largeFiles.length
      ? report.largeFiles.map((entry) => `- ${entry.file}: ${entry.lines}`)
      : ["- None"]),
    "",
    "## Syntactic review signals",
    "",
    `- ESLint disable directives: ${report.signals.eslintDisable.length}`,
    `- TypeScript ignore/expect-error directives: ${report.signals.tsDirective.length}`,
    `- Double assertions through unknown: ${report.signals.unsafeDoubleAssertion.length}`,
    "",
    "## Package test commands",
    "",
    ...(report.testCommands.length
      ? report.testCommands.map(
          (entry) => `- ${entry.package}: \`${entry.command}\``,
        )
      : ["- None"]),
    "",
    "## Interpretation",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ];
  return lines.join("\n");
}

function emptyPackageSummary(packageName) {
  return {
    package: packageName,
    production: { files: 0, lines: 0 },
    test: { files: 0, lines: 0 },
  };
}

function ownerFor(file) {
  const match = /^packages\/([^/]+)\//.exec(file);
  if (match) return match[1];
  if (/^scripts\//.test(file)) return "scripts";
  return "root";
}

function isSourceFile(file) {
  return SOURCE_EXTENSIONS.has(extname(file));
}

function isGenerated(file) {
  const normalized = `/${file}`;
  return GENERATED_SEGMENTS.some((segment) => normalized.includes(segment));
}

function isTestFile(file) {
  return (
    /(?:^|\/)tests?\//.test(file) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /\.test\.svelte\.[jt]s$/.test(file)
  );
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.endsWith("\n")
    ? text.split("\n").length - 1
    : text.split("\n").length;
}

function collectMatches(target, file, text, pattern) {
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(0, match.index);
    target.push({
      file,
      line: prefix.split("\n").length,
    });
  }
}
