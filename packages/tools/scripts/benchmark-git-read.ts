import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { runGitCommand } from "../src/git/git-command.js";
import {
  GitCliCompatibilityReadBackend,
  NativeGitReadBackend,
} from "../src/git/git-read-backend.js";

const args = process.argv.slice(2).filter((value) => value !== "--");
const invocationDir = process.env.INIT_CWD ?? process.cwd();
const repoDir = resolve(invocationDir, args[0] ?? ".");
const iterations = Number(args[1] ?? 5);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error("iterations must be an integer from 1 to 100");
}

const native = new NativeGitReadBackend();
let compatibilityProcessCount = 0;
const compatibility = new GitCliCompatibilityReadBackend((cwd, commandArgs) => {
  compatibilityProcessCount += 1;
  return runGitCommand("git", cwd, commandArgs);
});

async function measure(name: string, read: () => Promise<unknown>) {
  const samples: number[] = [];
  const cpuBefore = process.cpuUsage();
  const rssBefore = process.memoryUsage().rss;
  let value: unknown;
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    value = await read();
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  const cpu = process.cpuUsage(cpuBefore);
  const p95Index = Math.min(
    samples.length - 1,
    Math.ceil(samples.length * 0.95) - 1,
  );
  console.log(name, {
    medianMs: Number(samples[Math.floor(samples.length / 2)]?.toFixed(2)),
    p95Ms: Number(samples[p95Index]?.toFixed(2)),
    minMs: Number(samples[0]?.toFixed(2)),
    maxMs: Number(samples.at(-1)?.toFixed(2)),
    cpuMs: Number(((cpu.user + cpu.system) / 1_000).toFixed(2)),
    rssDeltaBytes: process.memoryUsage().rss - rssBefore,
  });
  return value;
}

const nativeSnapshot = await measure("native", () => native.snapshot(repoDir));
const cliSnapshot = await measure("cli-compatibility", () =>
  compatibility.snapshot(repoDir),
);
console.log("processes", {
  native: 0,
  cliCompatibility: compatibilityProcessCount,
});
console.log("parity", {
  branch: nativeSnapshot.branch.head === cliSnapshot.branch.head,
  statusEntries: [nativeSnapshot.files.length, cliSnapshot.files.length],
  refs: [nativeSnapshot.refs.length, cliSnapshot.refs.length],
  remotes: [nativeSnapshot.remotes.length, cliSnapshot.remotes.length],
  recentCommits: [
    nativeSnapshot.recentCommits.length,
    cliSnapshot.recentCommits.length,
  ],
  stashes: [nativeSnapshot.stashes.length, cliSnapshot.stashes.length],
});
const packageDir = resolve(import.meta.dirname, "../..");
const artifact = resolve(
  packageDir,
  "native/prebuilds/local/nerve_native.linux-x64-gnu.node",
);
console.log(
  "localArtifactBytes",
  await stat(artifact).then((value) => value.size),
);
