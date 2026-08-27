import type { ConversationLiveToolDraftProgressSnapshot } from "@nervekit/contracts";

export type ToolDraftProgressToolName = "write" | "edit";

type TargetProperty = "path" | "content" | "oldText" | "newText";

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
  | {
      property: "content" | "oldText" | "newText";
      metric: LineMetric;
      escaping: boolean;
      previewPrefix?: DiffPreviewPrefix;
      previewLineStart: boolean;
    };

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
  private closedOldTextLines = 0;
  private closedNewTextLines = 0;
  private activeOldTextMetric: LineMetric | undefined;
  private activeNewTextMetric: LineMetric | undefined;
  private readonly generatedPreview = new GeneratedPreviewTail();
  private generatedPreviewSegmentCount = 0;
  private lastSignature: string | undefined;

  constructor(private readonly toolName: ToolDraftProgressToolName) {}

  ingest(delta: string): void {
    for (const char of delta) this.processChar(char);
  }

  takeChangedSnapshot(): ConversationLiveToolDraftProgressSnapshot | undefined {
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

    const generatedLineCount =
      this.closedNewTextLines + (this.activeNewTextMetric?.count ?? 0);
    const deletedLineCount =
      this.closedOldTextLines + (this.activeOldTextMetric?.count ?? 0);
    return {
      path,
      operationCount:
        this.toolName === "edit"
          ? Math.max(this.oldTextCount, this.newTextCount)
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
    active.metric.add(char);
    this.appendTextPreviewChar(active, char);
  }

  private appendTextPreviewChar(
    active: Extract<
      ActiveValue,
      { property: "content" | "oldText" | "newText" }
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

function prefixDiffPreviewLines(
  text: string,
  prefix: DiffPreviewPrefix,
): string {
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

  for (const edit of arrayField(args.edits)) {
    const record = asRecord(edit);
    const oldText = stringField(record.oldText);
    if (oldText !== undefined) parts.push(prefixDiffPreviewLines(oldText, "-"));
    const newText = stringField(record.newText);
    if (newText !== undefined) parts.push(prefixDiffPreviewLines(newText, "+"));
  }

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
  let additions = 0;
  let deletions = 0;

  const edits = arrayField(args.edits);
  const operations = edits.length;
  for (const edit of edits) {
    const record = asRecord(edit);
    additions += lineCount(stringField(record.newText)) ?? 0;
    deletions += lineCount(stringField(record.oldText)) ?? 0;
  }

  return { operations, additions, deletions };
}
