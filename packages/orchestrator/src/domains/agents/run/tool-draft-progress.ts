import type { ConversationLiveToolDraftProgressSnapshot } from "@nervekit/shared";

export type ToolDraftProgressToolName = "write" | "edit";

type TargetProperty =
  | "path"
  | "content"
  | "oldText"
  | "newText"
  | "text"
  | "patch"
  | "operationType";

const PATH_MAX_CHARS = 240;
const PROPERTY_MAX_CHARS = 48;
const GENERATED_PREVIEW_LINES = 10;
const GENERATED_PREVIEW_MAX_CHARS = 8_000;

class LineMetric {
  private lines = 0;
  private sawContent = false;

  add(char: string): void {
    if (char === "\n") {
      this.lines = Math.max(this.lines, 1) + 1;
      this.sawContent = true;
      return;
    }
    if (char !== "\r") this.sawContent = true;
  }

  get count(): number {
    return Math.max(this.lines, this.sawContent ? 1 : 0);
  }
}

class PatchMetric {
  private line = "";
  additions = 0;
  deletions = 0;

  add(char: string): void {
    if (char === "\r") return;
    if (char === "\n") {
      this.finishLine();
      return;
    }
    this.line += char;
  }

  finish(): void {
    if (this.line.length > 0) this.finishLine();
  }

  private finishLine(): void {
    if (this.line.startsWith("+") && !this.line.startsWith("+++")) {
      this.additions += 1;
    } else if (this.line.startsWith("-") && !this.line.startsWith("---")) {
      this.deletions += 1;
    }
    this.line = "";
  }
}

class GeneratedPreviewTail {
  private text = "";

  append(char: string): void {
    if (char === "\r") return;
    this.text += char;
    this.trim();
  }

  appendText(text: string): void {
    for (const char of text) this.append(char);
  }

  get value(): string | undefined {
    return this.text.length > 0 ? this.text : undefined;
  }

  private trim(): void {
    if (this.text.length > GENERATED_PREVIEW_MAX_CHARS) {
      this.text = this.text.slice(-GENERATED_PREVIEW_MAX_CHARS);
    }

    let newlineCount = 0;
    for (let index = this.text.length - 1; index >= 0; index -= 1) {
      if (this.text[index] !== "\n") continue;
      newlineCount += 1;
      if (newlineCount >= GENERATED_PREVIEW_LINES) {
        this.text = this.text.slice(index + 1);
        return;
      }
    }
  }
}

function tailGeneratedPreview(texts: string[]): string | undefined {
  const tail = new GeneratedPreviewTail();
  for (const text of texts) {
    if (text.length === 0) continue;
    if (tail.value) tail.append("\n");
    tail.appendText(text);
  }
  return tail.value;
}

type DiffPreviewPrefix = "+" | "-";

type ActiveValue =
  | { property: "path"; text: string; escaping: boolean }
  | { property: "operationType"; text: string; escaping: boolean }
  | {
      property: "content" | "oldText" | "newText" | "text";
      metric: LineMetric;
      escaping: boolean;
      previewPrefix?: DiffPreviewPrefix;
      previewLineStart: boolean;
    }
  | { property: "patch"; metric: PatchMetric; escaping: boolean };

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function targetFor(
  toolName: ToolDraftProgressToolName,
  property: string,
): TargetProperty | undefined {
  if (property === "path") return "path";
  if (toolName === "write" && property === "content") return "content";
  if (toolName === "edit" && property === "oldText") return "oldText";
  if (toolName === "edit" && property === "newText") return "newText";
  if (toolName === "edit" && property === "text") return "text";
  if (toolName === "edit" && property === "patch") return "patch";
  if (toolName === "edit" && property === "type") {
    return "operationType";
  }
  return undefined;
}

function lineCount(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function hasProgress(
  snapshot: ConversationLiveToolDraftProgressSnapshot,
): boolean {
  return Boolean(
    snapshot.path ||
      (snapshot.lineCount !== undefined && snapshot.lineCount > 0) ||
      (snapshot.operationCount !== undefined && snapshot.operationCount > 0) ||
      (snapshot.generatedLineCount !== undefined &&
        snapshot.generatedLineCount > 0) ||
      (snapshot.estimatedAdditions !== undefined &&
        snapshot.estimatedAdditions > 0) ||
      (snapshot.estimatedDeletions !== undefined &&
        snapshot.estimatedDeletions > 0) ||
      Boolean(snapshot.generatedPreview),
  );
}

function signature(
  snapshot: ConversationLiveToolDraftProgressSnapshot,
): string {
  return JSON.stringify(snapshot);
}

/**
 * Best-effort streaming scanner for write/edit JSON arguments. It deliberately
 * tracks only metadata and counters; generated file contents and replacement
 * text are never retained in full by this helper.
 */
export class ToolDraftProgressAccumulator {
  private inGenericString = false;
  private genericString = "";
  private genericEscaping = false;
  private pendingString: string | undefined;
  private awaitingValueFor: TargetProperty | undefined;
  private activeValue: ActiveValue | undefined;

  private closedPath: string | undefined;
  private activePath: string | undefined;
  private closedContentLineCount: number | undefined;
  private activeContentMetric: LineMetric | undefined;
  private oldTextCount = 0;
  private newTextCount = 0;
  private insertedTextCount = 0;
  private patchCount = 0;
  private closedOldTextLines = 0;
  private closedNewTextLines = 0;
  private closedInsertedTextLines = 0;
  private closedPatchAdditions = 0;
  private closedPatchDeletions = 0;
  private activeOldTextMetric: LineMetric | undefined;
  private activeNewTextMetric: LineMetric | undefined;
  private activeInsertedTextMetric: LineMetric | undefined;
  private activePatchMetric: PatchMetric | undefined;
  private readonly generatedPreview = new GeneratedPreviewTail();
  private generatedPreviewSegmentCount = 0;
  private lastSignature: string | undefined;

  constructor(private readonly toolName: ToolDraftProgressToolName) {}

  push(delta: string): ConversationLiveToolDraftProgressSnapshot | undefined {
    for (const char of delta) this.processChar(char);
    const snapshot = this.snapshot();
    if (!hasProgress(snapshot)) return undefined;
    const currentSignature = signature(snapshot);
    if (currentSignature === this.lastSignature) return undefined;
    this.lastSignature = currentSignature;
    return snapshot;
  }

  snapshot(): ConversationLiveToolDraftProgressSnapshot {
    const path = this.activePath ?? this.closedPath;
    const generatedPreview = this.generatedPreview.value;
    if (this.toolName === "write") {
      const lineCount =
        this.activeContentMetric?.count ?? this.closedContentLineCount;
      return {
        path,
        lineCount,
        generatedLineCount: lineCount,
        generatedPreview,
        estimated: true,
      };
    }

    const activePatchAdditions = this.activePatchMetric?.additions ?? 0;
    const activePatchDeletions = this.activePatchMetric?.deletions ?? 0;
    const generatedLineCount =
      this.closedNewTextLines +
      (this.activeNewTextMetric?.count ?? 0) +
      this.closedInsertedTextLines +
      (this.activeInsertedTextMetric?.count ?? 0) +
      this.closedPatchAdditions +
      activePatchAdditions;
    const deletedLineCount =
      this.closedOldTextLines +
      (this.activeOldTextMetric?.count ?? 0) +
      this.closedPatchDeletions +
      activePatchDeletions;
    return {
      path,
      operationCount:
        this.toolName === "edit"
          ? Math.max(this.oldTextCount, this.newTextCount) +
            this.insertedTextCount +
            this.patchCount
          : undefined,
      generatedLineCount,
      estimatedAdditions: generatedLineCount,
      estimatedDeletions: deletedLineCount,
      generatedPreview,
      generatedPreviewLanguage:
        generatedPreview && this.generatedPreviewSegmentCount > 0
          ? "diff"
          : undefined,
      estimated: true,
    };
  }

  private processChar(char: string): void {
    if (this.activeValue) {
      this.processActiveValueChar(char);
      return;
    }
    if (this.inGenericString) {
      this.processGenericStringChar(char);
      return;
    }
    if (this.pendingString !== undefined) {
      if (isWhitespace(char)) return;
      const property = this.pendingString;
      this.pendingString = undefined;
      if (char === ":") {
        this.awaitingValueFor = targetFor(this.toolName, property);
        return;
      }
    }
    if (this.awaitingValueFor) {
      if (isWhitespace(char)) return;
      const property = this.awaitingValueFor;
      this.awaitingValueFor = undefined;
      if (char === '"') this.startTargetValue(property);
      return;
    }
    if (char === '"') {
      this.inGenericString = true;
      this.genericString = "";
      this.genericEscaping = false;
    }
  }

  private processGenericStringChar(char: string): void {
    if (this.genericEscaping) {
      this.appendGenericStringChar(decodeEscape(char));
      this.genericEscaping = false;
      return;
    }
    if (char === "\\") {
      this.genericEscaping = true;
      return;
    }
    if (char === '"') {
      this.inGenericString = false;
      this.pendingString = this.genericString;
      this.genericString = "";
      return;
    }
    this.appendGenericStringChar(char);
  }

  private appendGenericStringChar(char: string): void {
    if (this.genericString.length < PROPERTY_MAX_CHARS) {
      this.genericString += char;
    }
  }

  private beginGeneratedPreviewSegment(): void {
    if (this.generatedPreview.value) this.generatedPreview.append("\n");
    this.generatedPreviewSegmentCount += 1;
  }

  private startTargetValue(property: TargetProperty): void {
    switch (property) {
      case "path":
        this.activePath = "";
        this.activeValue = { property, text: "", escaping: false };
        break;
      case "content": {
        const metric = new LineMetric();
        this.beginGeneratedPreviewSegment();
        this.activeContentMetric = metric;
        this.activeValue = {
          property,
          metric,
          escaping: false,
          previewLineStart: true,
        };
        break;
      }
      case "oldText": {
        const metric = new LineMetric();
        this.oldTextCount += 1;
        this.beginGeneratedPreviewSegment();
        this.activeOldTextMetric = metric;
        this.activeValue = {
          property,
          metric,
          escaping: false,
          previewPrefix: "-",
          previewLineStart: true,
        };
        break;
      }
      case "newText": {
        const metric = new LineMetric();
        this.newTextCount += 1;
        this.beginGeneratedPreviewSegment();
        this.activeNewTextMetric = metric;
        this.activeValue = {
          property,
          metric,
          escaping: false,
          previewPrefix: "+",
          previewLineStart: true,
        };
        break;
      }
      case "text": {
        const metric = new LineMetric();
        this.insertedTextCount += 1;
        this.beginGeneratedPreviewSegment();
        this.activeInsertedTextMetric = metric;
        this.activeValue = {
          property,
          metric,
          escaping: false,
          previewPrefix: "+",
          previewLineStart: true,
        };
        break;
      }
      case "patch": {
        const metric = new PatchMetric();
        this.patchCount += 1;
        this.beginGeneratedPreviewSegment();
        this.activePatchMetric = metric;
        this.activeValue = { property, metric, escaping: false };
        break;
      }
      case "operationType":
        this.activeValue = { property, text: "", escaping: false };
        break;
    }
  }

  private processActiveValueChar(char: string): void {
    const active = this.activeValue;
    if (!active) return;
    if (active.escaping) {
      this.addActiveValueChar(active, decodeEscape(char));
      active.escaping = false;
      return;
    }
    if (char === "\\") {
      active.escaping = true;
      return;
    }
    if (char === '"') {
      this.finishActiveValue(active);
      return;
    }
    this.addActiveValueChar(active, char);
  }

  private addActiveValueChar(active: ActiveValue, char: string): void {
    if (active.property === "path") {
      if (active.text.length < PATH_MAX_CHARS) {
        active.text += char;
        this.activePath = active.text;
      }
      return;
    }
    if (active.property === "operationType") {
      if (active.text.length < PROPERTY_MAX_CHARS) active.text += char;
      return;
    }
    active.metric.add(char);
    if (active.property === "patch") {
      this.generatedPreview.append(char);
      return;
    }
    this.appendTextPreviewChar(active, char);
  }

  private appendTextPreviewChar(
    active: Extract<
      ActiveValue,
      { property: "content" | "oldText" | "newText" | "text" }
    >,
    char: string,
  ): void {
    if (active.previewPrefix && active.previewLineStart) {
      this.generatedPreview.append(active.previewPrefix);
    }
    this.generatedPreview.append(char);
    active.previewLineStart = char === "\n";
  }

  private finishActiveValue(active: ActiveValue): void {
    switch (active.property) {
      case "path":
        this.closedPath = active.text;
        this.activePath = undefined;
        break;
      case "content":
        this.closedContentLineCount = active.metric.count;
        this.activeContentMetric = undefined;
        break;
      case "oldText":
        this.closedOldTextLines += active.metric.count;
        this.activeOldTextMetric = undefined;
        break;
      case "newText":
        this.closedNewTextLines += active.metric.count;
        this.activeNewTextMetric = undefined;
        break;
      case "text":
        this.closedInsertedTextLines += active.metric.count;
        this.activeInsertedTextMetric = undefined;
        break;
      case "patch":
        active.metric.finish();
        this.closedPatchAdditions += active.metric.additions;
        this.closedPatchDeletions += active.metric.deletions;
        this.activePatchMetric = undefined;
        break;
      case "operationType":
        break;
    }
    this.activeValue = undefined;
  }
}

function decodeEscape(char: string): string {
  if (char === "n") return "\n";
  if (char === "r") return "\r";
  if (char === "t") return "\t";
  return char;
}

export function createToolDraftProgressAccumulator(
  toolName: string | undefined,
): ToolDraftProgressAccumulator | undefined {
  if (toolName === "write" || toolName === "edit") {
    return new ToolDraftProgressAccumulator(toolName);
  }
  return undefined;
}

function prefixDiffPreviewLines(text: string, prefix: DiffPreviewPrefix): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function finalEditGeneratedPreview(args: Record<string, unknown>): {
  generatedPreview?: string;
  generatedPreviewLanguage?: "diff";
} {
  const parts: string[] = [];

  for (const replacement of arrayField(args.replacements)) {
    const record = asRecord(replacement);
    const oldText = stringField(record.oldText);
    if (oldText !== undefined) parts.push(prefixDiffPreviewLines(oldText, "-"));
    const newText = stringField(record.newText);
    if (newText !== undefined) parts.push(prefixDiffPreviewLines(newText, "+"));
  }
  for (const insertion of arrayField(args.insertions)) {
    const text = stringField(asRecord(insertion).text);
    if (text !== undefined) parts.push(prefixDiffPreviewLines(text, "+"));
  }
  for (const replacement of arrayField(args.lineReplacements)) {
    const text = stringField(asRecord(replacement).newText);
    if (text !== undefined) parts.push(prefixDiffPreviewLines(text, "+"));
  }
  for (const insertion of arrayField(args.lineInsertions)) {
    const text = stringField(asRecord(insertion).text);
    if (text !== undefined) parts.push(prefixDiffPreviewLines(text, "+"));
  }
  const patch = stringField(args.patch);
  if (patch !== undefined) parts.push(patch);

  const generatedPreview = tailGeneratedPreview(parts);
  return {
    generatedPreview,
    generatedPreviewLanguage: generatedPreview ? "diff" : undefined,
  };
}

export function finalToolDraftProgress(
  toolName: string,
  args: Record<string, unknown>,
): ConversationLiveToolDraftProgressSnapshot | undefined {
  if (toolName === "write") {
    const path = stringField(args.path);
    const content = stringField(args.content);
    const lineCountValue = lineCount(content);
    const snapshot: ConversationLiveToolDraftProgressSnapshot = {
      path,
      lineCount: lineCountValue,
      generatedLineCount: lineCountValue,
      generatedPreview:
        content !== undefined ? tailGeneratedPreview([content]) : undefined,
      estimated: false,
    };
    return hasProgress(snapshot) ? snapshot : undefined;
  }

  if (toolName !== "edit") {
    return undefined;
  }
  const stats = editShorthandStats(args);
  const preview = finalEditGeneratedPreview(args);
  const snapshot: ConversationLiveToolDraftProgressSnapshot = {
    path: stringField(args.path),
    operationCount: stats.operations,
    generatedLineCount: stats.additions,
    estimatedAdditions: stats.additions,
    estimatedDeletions: stats.deletions,
    ...preview,
    estimated: false,
  };
  return hasProgress(snapshot) ? snapshot : undefined;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function editShorthandStats(args: Record<string, unknown>): {
  operations: number;
  additions: number;
  deletions: number;
} {
  let operations = 0;
  let additions = 0;
  let deletions = 0;

  const replacements = arrayField(args.replacements);
  operations += replacements.length;
  for (const replacement of replacements) {
    const record = asRecord(replacement);
    additions += lineCount(stringField(record.newText)) ?? 0;
    deletions += lineCount(stringField(record.oldText)) ?? 0;
  }

  const insertions = arrayField(args.insertions);
  operations += insertions.length;
  for (const insertion of insertions) {
    additions += lineCount(stringField(asRecord(insertion).text)) ?? 0;
  }

  const lineReplacements = arrayField(args.lineReplacements);
  operations += lineReplacements.length;
  for (const replacement of lineReplacements) {
    additions += lineCount(stringField(asRecord(replacement).newText)) ?? 0;
  }

  const lineInsertions = arrayField(args.lineInsertions);
  operations += lineInsertions.length;
  for (const insertion of lineInsertions) {
    additions += lineCount(stringField(asRecord(insertion).text)) ?? 0;
  }

  const patch = stringField(args.patch);
  if (patch) {
    operations += 1;
    const patchStats = patchLineStats(patch);
    additions += patchStats.additions;
    deletions += patchStats.deletions;
  }

  return { operations, additions, deletions };
}

function patchLineStats(patch: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}
