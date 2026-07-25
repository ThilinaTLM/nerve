import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(root, "native", "benchmark-results");
await mkdir(outputDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
}

if (!process.argv.includes("--skip-build")) {
  run("cargo", ["build", "--release", "-p", "nerve-gpui"]);
}

const executable = join(
  root,
  "target",
  "release",
  process.platform === "win32" ? "nerve-gpui.exe" : "nerve-gpui",
);
const nativeMetricsPath = join(outputDir, "native-model.json");
run(executable, ["--benchmark-model-out", nativeMetricsPath]);

const nativeModel = JSON.parse(await readFile(nativeMetricsPath, "utf8"));
const executableStats = await stat(executable);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? "unknown",
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    node: process.version,
  },
  native: {
    executableBytes: executableStats.size,
    model: nativeModel,
  },
  interactiveComparison: {
    status: "pending-manual-capture",
    requiredRuns: 3,
    metrics: [
      "firstInteractiveMs",
      "idleClientRssBytes",
      "typingToPaintP95Ms",
      "scrollFrameP95Ms",
      "framesOver33msPercent",
      "conversationSwitchP95Ms",
    ],
    note: "Run release Electron and GPUI builds on identical data, viewport, scale, and hardware. The shared daemon is excluded from both client totals.",
  },
};

const reportPath = join(outputDir, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Native UI benchmark scaffold wrote ${reportPath}`);
console.log(
  "Interactive frame, input, memory, and Electron-control measurements are still required for a go/no-go decision.",
);
