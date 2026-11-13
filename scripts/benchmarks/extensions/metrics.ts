import type { Loose } from "./loose.ts";
import type { Variant } from "./types.ts";

/** The subset of a conversation event the metrics read. */
export interface BenchEvent {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: Loose;
}

export interface RunMetrics {
  turns: number;
  toolCalls: number;
  /** Sum of input + cache read + cache write over all requests. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  firstRequestInputTokens: number;
  /** Input tokens of every request up to and including the one that issued the first successful SDK call. */
  tokensBeforeFirstSdkSuccess: number | undefined;
  /** Requests up to and including that one. */
  requestsBeforeFirstSdkSuccess: number | undefined;
  sdkCalls: number;
  sdkSuccesses: number;
  discoveryCalls: number;
  failedWrongArguments: number;
  unavailableNamespaceCalls: number;
  failedOther: number;
  approvalsRequested: number;
  approvalsDenied: number;
}

const DIRECT_SDK = /^(jira|confluence)_|^kroki_export$/;
const SDK_NAMESPACES = /\b(?:jira|confluence|diagram|web|imagegen)\s*\./;
const DISCOVERY_ONLY = /\bsdk\s*\./;
const UNAVAILABLE =
  /not available in quick_script|is unavailable|_NOT_CONFIGURED|not configured|Unknown namespace|unknown tool|tool .* (?:is )?not (?:available|enabled)|not enabled/i;
const WRONG_ARGUMENTS =
  /Unknown method|has no method|unknown (?:option|field|argument|parameter|property)|unrecognized|invalid (?:argument|parameter|input|value|arguments)|validation|BAD_REQUEST|is required|required (?:field|property|parameter)|expected .* (?:received|got)|must be|not a function|is not defined|TypeError|Did you mean|Invalid input/i;

export function textOf(projection: unknown): string {
  if (!Array.isArray(projection)) return "";
  return projection
    .map((block) =>
      block && typeof block === "object" && block.type === "text"
        ? String(block.text ?? "")
        : "",
    )
    .join("\n");
}

export function requestInputTokens(usage: Loose): number {
  return (
    Number(usage?.input ?? 0) +
    Number(usage?.cacheRead ?? 0) +
    Number(usage?.cacheWrite ?? 0)
  );
}

/** Whether a tool call is an SDK data call (as opposed to discovery or a local tool). */
export function isSdkCall(
  variant: Variant,
  toolName: string,
  args: unknown,
): boolean {
  if (variant === "direct") return DIRECT_SDK.test(toolName);
  if (toolName !== "quick_script") return false;
  return SDK_NAMESPACES.test(JSON.stringify(args ?? {}));
}

function isDiscoveryCall(
  variant: Variant,
  toolName: string,
  args: unknown,
): boolean {
  if (variant !== "quick_script" || toolName !== "quick_script") return false;
  const text = JSON.stringify(args ?? {});
  return DISCOVERY_ONLY.test(text) && !SDK_NAMESPACES.test(text);
}

/** Calls the model made to a tool that the variant does not offer. */
function offeredElsewhere(variant: Variant, toolName: string): boolean {
  return variant === "quick_script"
    ? /^(jira|confluence)_/.test(toolName) || toolName === "kroki_export"
    : toolName === "quick_script";
}

export function analyzeEvents(
  variant: Variant,
  events: readonly BenchEvent[],
): RunMetrics {
  const metrics: RunMetrics = {
    turns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    firstRequestInputTokens: 0,
    tokensBeforeFirstSdkSuccess: undefined,
    requestsBeforeFirstSdkSuccess: undefined,
    sdkCalls: 0,
    sdkSuccesses: 0,
    discoveryCalls: 0,
    failedWrongArguments: 0,
    unavailableNamespaceCalls: 0,
    failedOther: 0,
    approvalsRequested: 0,
    approvalsDenied: 0,
  };
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const requestOfEvent = new Map<string, number>();
  const inputAfterRequest: number[] = [];
  let running = 0;
  for (const event of ordered) {
    if (event.type !== "assistant_message") continue;
    const usage = event.payload.usage;
    const input = requestInputTokens(usage);
    metrics.turns += 1;
    metrics.inputTokens += input;
    metrics.outputTokens += Number(usage?.output ?? 0);
    metrics.totalTokens += Number(usage?.totalTokens ?? 0);
    if (metrics.turns === 1) metrics.firstRequestInputTokens = input;
    running += input;
    inputAfterRequest.push(running);
    requestOfEvent.set(event.id, metrics.turns);
  }
  for (const event of ordered) {
    if (event.type !== "tool_call_response") continue;
    const p = event.payload;
    if (p.origin !== "model") continue;
    metrics.toolCalls += 1;
    const supervision = p.supervision;
    if (supervision?.decision === "approval") metrics.approvalsRequested += 1;
    if (p.outcome === "denied") metrics.approvalsDenied += 1;
    const sdk = isSdkCall(variant, p.toolName, p.arguments);
    if (sdk) metrics.sdkCalls += 1;
    if (isDiscoveryCall(variant, p.toolName, p.arguments))
      metrics.discoveryCalls += 1;
    const message = textOf(p.agentProjection);
    const failed = p.outcome === "failed";
    if (p.outcome === "completed" && sdk) {
      metrics.sdkSuccesses += 1;
      if (metrics.tokensBeforeFirstSdkSuccess === undefined) {
        const request = requestOfEvent.get(p.assistantEventId);
        if (request !== undefined) {
          metrics.requestsBeforeFirstSdkSuccess = request;
          metrics.tokensBeforeFirstSdkSuccess = inputAfterRequest[request - 1];
        }
      }
    }
    if (offeredElsewhere(variant, p.toolName)) {
      metrics.unavailableNamespaceCalls += 1;
    } else if (failed || p.outcome === "denied") {
      if (p.outcome === "denied") continue;
      if (UNAVAILABLE.test(message)) metrics.unavailableNamespaceCalls += 1;
      else if (WRONG_ARGUMENTS.test(message)) metrics.failedWrongArguments += 1;
      else metrics.failedOther += 1;
    }
  }
  return metrics;
}

/** Text of the last assistant message that issued no tool call. */
export function finalAnswer(events: readonly BenchEvent[]): string {
  const messages = events
    .filter((event) => event.type === "assistant_message")
    .sort((a, b) => b.sequence - a.sequence);
  for (const event of messages) {
    const content: Loose[] = event.payload.content ?? [];
    if (content.some((block) => block.type === "toolCall")) continue;
    return content
      .filter((block) => block.type === "text")
      .map((block) => String(block.text))
      .join("\n")
      .trim();
  }
  return "";
}
