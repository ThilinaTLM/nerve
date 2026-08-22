import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join } from "node:path";

const DATASET_SCHEMA_VERSION = 1;
const REVIEW_CHOICES = new Set(["A", "B", "tie", "both_bad"]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPrompt(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function stableSplit(caseId) {
  return Number.parseInt(caseId.slice(0, 2), 16) % 5 === 0 ? "holdout" : "tune";
}

function stableSide(caseId) {
  return Number.parseInt(caseId.slice(2, 4), 16) % 2 === 0 ? "A" : "B";
}

function percentile(values, fraction) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function lengthSummary(values) {
  if (values.length === 0) return { median: 0, p95: 0, max: 0 };
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonLines(path) {
  const text = await readFile(path, "utf8");
  const records = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Malformed JSONL at ${path}:${index + 1}`, {
        cause: error,
      });
    }
  }
  return records;
}

async function writePrivate(path, content) {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function writeJson(path, value) {
  await writePrivate(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonLines(path, records) {
  await writePrivate(
    path,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

async function prepareOutputDirectory(output, force) {
  try {
    await stat(output);
    if (!force) {
      throw new Error(
        `Output already exists: ${output}. Pass --force to replace it.`,
      );
    }
    await rm(output, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  await chmod(output, 0o700);
}

function validConversation(record) {
  return (
    record &&
    typeof record === "object" &&
    typeof record.id === "string" &&
    typeof record.title === "string"
  );
}

function earliestUserEntry(entries) {
  return entries
    .map((entry, fileIndex) => ({ entry, fileIndex }))
    .filter(
      ({ entry }) => entry?.role === "user" && typeof entry.text === "string",
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.entry.createdAt ?? "");
      const rightTime = Date.parse(right.entry.createdAt ?? "");
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        return leftTime - rightTime || left.fileIndex - right.fileIndex;
      }
      if (Number.isFinite(leftTime)) return -1;
      if (Number.isFinite(rightTime)) return 1;
      return left.fileIndex - right.fileIndex;
    })[0]?.entry;
}

export async function collectConversationCases({ home, generateTitle }) {
  const conversationsRoot = join(home, "conversations");
  const names = await readdir(conversationsRoot, { withFileTypes: true });
  const cases = [];
  const skipped = {
    missingRecord: 0,
    missingEntries: 0,
    malformedRecord: 0,
    malformedEntries: 0,
    noUserEntry: 0,
  };

  for (const directory of names
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const root = join(conversationsRoot, directory.name);
    let conversation;
    try {
      conversation = await readJson(join(root, "conversation.json"));
    } catch (error) {
      if (error?.code === "ENOENT") skipped.missingRecord += 1;
      else skipped.malformedRecord += 1;
      continue;
    }
    if (!validConversation(conversation)) {
      skipped.malformedRecord += 1;
      continue;
    }

    let entries;
    try {
      entries = await readJsonLines(join(root, "entries.jsonl"));
    } catch (error) {
      if (error?.code === "ENOENT") skipped.missingEntries += 1;
      else skipped.malformedEntries += 1;
      continue;
    }
    const firstUser = earliestUserEntry(entries);
    if (!firstUser) {
      skipped.noUserEntry += 1;
      continue;
    }

    const prompt = firstUser.text;
    const caseId = hash(conversation.id);
    const normalizedPromptHash = hash(normalizedPrompt(prompt));
    cases.push({
      id: caseId,
      prompt,
      recordedTitle: conversation.title,
      baselineTitle: generateTitle(prompt),
      normalizedPromptHash,
      duplicateGroupSize: 0,
      split: stableSplit(caseId),
    });
  }

  const duplicateCounts = new Map();
  for (const item of cases) {
    duplicateCounts.set(
      item.normalizedPromptHash,
      (duplicateCounts.get(item.normalizedPromptHash) ?? 0) + 1,
    );
  }
  for (const item of cases) {
    item.duplicateGroupSize = duplicateCounts.get(item.normalizedPromptHash);
  }

  return { cases, skipped, scannedDirectories: names.length };
}

export async function prepareDataset({
  home,
  output,
  generateTitle,
  revision,
  force = false,
  generatedAt = new Date().toISOString(),
}) {
  const result = await collectConversationCases({ home, generateTitle });
  await prepareOutputDirectory(output, force);
  await writeJsonLines(join(output, "cases.jsonl"), result.cases);
  const manifest = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt,
    baselineRevision: revision,
    sourceFormat:
      "NERVE_HOME/conversations/*/{conversation.json,entries.jsonl}",
    counts: {
      scannedDirectories: result.scannedDirectories,
      cases: result.cases.length,
      uniquePrompts: new Set(
        result.cases.map((item) => item.normalizedPromptHash),
      ).size,
      tune: result.cases.filter((item) => item.split === "tune").length,
      holdout: result.cases.filter((item) => item.split === "holdout").length,
      skipped: result.skipped,
    },
  };
  await writeJson(join(output, "manifest.json"), manifest);
  return manifest;
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isFallback(title) {
  return [
    "New Conversation",
    "File Review",
    "Image Review",
    "Link Review",
  ].includes(title);
}

function summarizeCandidates(records) {
  const unique = [];
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.normalizedPromptHash)) continue;
    seen.add(record.normalizedPromptHash);
    unique.push(record);
  }
  const groupSummary = (items) => ({
    cases: items.length,
    changed: items.filter((item) => item.baselineTitle !== item.candidateTitle)
      .length,
    empty: items.filter((item) => item.diagnostics.empty).length,
    over80: items.filter((item) => item.diagnostics.codePointLength > 80)
      .length,
    loneSurrogate: items.filter((item) => item.diagnostics.loneSurrogate)
      .length,
    baselineFallbacks: items.filter((item) => isFallback(item.baselineTitle))
      .length,
    candidateFallbacks: items.filter((item) => isFallback(item.candidateTitle))
      .length,
    baselineLength: lengthSummary(
      items.map((item) => Array.from(item.baselineTitle).length),
    ),
    candidateLength: lengthSummary(
      items.map((item) => item.diagnostics.codePointLength),
    ),
    durationMs: lengthSummary(items.map((item) => item.diagnostics.durationMs)),
  });
  return {
    allUniquePrompts: groupSummary(unique),
    tune: groupSummary(unique.filter((item) => item.split === "tune")),
    holdout: groupSummary(unique.filter((item) => item.split === "holdout")),
  };
}

export async function compareDataset({ dataset, generateTitle }) {
  const cases = await readJsonLines(join(dataset, "cases.jsonl"));
  const candidates = cases.map((item) => {
    const startedAt = performance.now();
    const candidateTitle = generateTitle(item.prompt);
    const durationMs = performance.now() - startedAt;
    return {
      ...item,
      candidateTitle,
      diagnostics: {
        codePointLength: Array.from(candidateTitle).length,
        empty: candidateTitle.trim().length === 0,
        fallback: isFallback(candidateTitle),
        loneSurrogate: hasLoneSurrogate(candidateTitle),
        durationMs,
      },
    };
  });
  const review = [];
  const reviewKey = [];
  for (const item of candidates) {
    const baselineSide = stableSide(item.id);
    const candidateSide = baselineSide === "A" ? "B" : "A";
    review.push({
      id: item.id,
      split: item.split,
      prompt: item.prompt,
      titleA: baselineSide === "A" ? item.baselineTitle : item.candidateTitle,
      titleB: baselineSide === "B" ? item.baselineTitle : item.candidateTitle,
      preference: null,
      referenceTitle: null,
      notes: null,
    });
    reviewKey.push({ id: item.id, baselineSide, candidateSide });
  }
  const summary = summarizeCandidates(candidates);
  await writeJsonLines(join(dataset, "candidates.jsonl"), candidates);
  await writeJsonLines(join(dataset, "review.jsonl"), review);
  await writeJsonLines(join(dataset, "review-key.jsonl"), reviewKey);
  await writeJson(join(dataset, "comparison-summary.json"), summary);
  return summary;
}

function wilsonInterval(successes, total) {
  if (total === 0) return undefined;
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / total + (z * z) / (4 * total * total),
    );
  return { low: center - margin, high: center + margin };
}

function preferenceSummary(records) {
  const candidateWins = records.filter(
    (item) => item.resolvedPreference === "candidate",
  ).length;
  const baselineWins = records.filter(
    (item) => item.resolvedPreference === "baseline",
  ).length;
  const decisive = candidateWins + baselineWins;
  return {
    reviewed: records.length,
    candidateWins,
    baselineWins,
    ties: records.filter((item) => item.resolvedPreference === "tie").length,
    bothBad: records.filter((item) => item.resolvedPreference === "both_bad")
      .length,
    decisiveCandidateWinRate:
      decisive === 0 ? undefined : candidateWins / decisive,
    decisiveCandidateWinWilson95: wilsonInterval(candidateWins, decisive),
  };
}

export async function reportDataset({ dataset, reviewPath }) {
  const manifest = await readJson(join(dataset, "manifest.json"));
  const reviews = await readJsonLines(
    reviewPath ?? join(dataset, "review.jsonl"),
  );
  const keys = await readJsonLines(join(dataset, "review-key.jsonl"));
  const keyById = new Map(keys.map((item) => [item.id, item]));
  const completed = [];
  for (const review of reviews) {
    if (review.preference === null || review.preference === "") continue;
    if (!REVIEW_CHOICES.has(review.preference)) {
      throw new Error(`Invalid preference for case ${review.id}`);
    }
    const key = keyById.get(review.id);
    if (!key) throw new Error(`Missing review key for case ${review.id}`);
    const resolvedPreference =
      review.preference === "tie" || review.preference === "both_bad"
        ? review.preference
        : review.preference === key.candidateSide
          ? "candidate"
          : "baseline";
    completed.push({ ...review, resolvedPreference });
  }
  const report = {
    totalCases: manifest.counts.cases,
    coverage:
      manifest.counts.cases === 0
        ? 0
        : completed.length / manifest.counts.cases,
    all: preferenceSummary(completed),
    tune: preferenceSummary(completed.filter((item) => item.split === "tune")),
    holdout: preferenceSummary(
      completed.filter((item) => item.split === "holdout"),
    ),
  };
  await writeJson(join(dataset, "review-report.json"), report);
  return report;
}

export const evaluationInternals = {
  hash,
  stableSide,
  stableSplit,
  wilsonInterval,
};
