import type { ConversationLiveToolDraftProgressSnapshot } from "@nerve/shared";

export type ToolDraftProgressToolName = "write" | "edit";

type TargetProperty = "path" | "content" | "oldText" | "newText";

const PATH_MAX_CHARS = 240;
const PROPERTY_MAX_CHARS = 48;

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

type ActiveValue =
  | { property: "path"; text: string; escaping: boolean }
  | {
      property: "content" | "oldText" | "newText";
      metric: LineMetric;
      escaping: boolean;
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
      (snapshot.replacementCount !== undefined &&
        snapshot.replacementCount > 0) ||
      (snapshot.generatedLineCount !== undefined &&
        snapshot.generatedLineCount > 0) ||
      (snapshot.estimatedAdditions !== undefined &&
        snapshot.estimatedAdditions > 0) ||
      (snapshot.estimatedDeletions !== undefined &&
        snapshot.estimatedDeletions > 0),
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
    if (this.toolName === "write") {
      const lineCount =
        this.activeContentMetric?.count ?? this.closedContentLineCount;
      return {
        path,
        lineCount,
        generatedLineCount: lineCount,
        estimated: true,
      };
    }

    const generatedLineCount =
      this.closedNewTextLines + (this.activeNewTextMetric?.count ?? 0);
    const deletedLineCount =
      this.closedOldTextLines + (this.activeOldTextMetric?.count ?? 0);
    return {
      path,
      replacementCount: Math.max(this.oldTextCount, this.newTextCount),
      generatedLineCount,
      estimatedAdditions: generatedLineCount,
      estimatedDeletions: deletedLineCount,
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

  private startTargetValue(property: TargetProperty): void {
    switch (property) {
      case "path":
        this.activePath = "";
        this.activeValue = { property, text: "", escaping: false };
        break;
      case "content": {
        const metric = new LineMetric();
        this.activeContentMetric = metric;
        this.activeValue = { property, metric, escaping: false };
        break;
      }
      case "oldText": {
        const metric = new LineMetric();
        this.oldTextCount += 1;
        this.activeOldTextMetric = metric;
        this.activeValue = { property, metric, escaping: false };
        break;
      }
      case "newText": {
        const metric = new LineMetric();
        this.newTextCount += 1;
        this.activeNewTextMetric = metric;
        this.activeValue = { property, metric, escaping: false };
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

export function finalToolDraftProgress(
  toolName: string,
  args: Record<string, unknown>,
): ConversationLiveToolDraftProgressSnapshot | undefined {
  if (toolName === "write") {
    const path = stringField(args.path);
    const lineCountValue = lineCount(stringField(args.content));
    const snapshot: ConversationLiveToolDraftProgressSnapshot = {
      path,
      lineCount: lineCountValue,
      generatedLineCount: lineCountValue,
      estimated: false,
    };
    return hasProgress(snapshot) ? snapshot : undefined;
  }

  if (toolName !== "edit" || !Array.isArray(args.edits)) return undefined;
  let generatedLineCount = 0;
  let deletedLineCount = 0;
  for (const edit of args.edits) {
    const record = asRecord(edit);
    generatedLineCount += lineCount(stringField(record.newText)) ?? 0;
    deletedLineCount += lineCount(stringField(record.oldText)) ?? 0;
  }
  const snapshot: ConversationLiveToolDraftProgressSnapshot = {
    path: stringField(args.path),
    replacementCount: args.edits.length,
    generatedLineCount,
    estimatedAdditions: generatedLineCount,
    estimatedDeletions: deletedLineCount,
    estimated: false,
  };
  return hasProgress(snapshot) ? snapshot : undefined;
}
