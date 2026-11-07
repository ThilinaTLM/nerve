/** Network and WebSocket frame capture with per-RPC-method aggregation. */
import type { Cdp } from "./cdp.ts";
import { round } from "./measure.ts";

export interface NetworkSummary {
  requests: number;
  responseBytes: number;
  requestBytes: number;
  totalDurationMs: number;
  slowest: { url: string; ms: number; bytes: number; method: string }[];
  webSocketFramesSent: number;
  webSocketFramesReceived: number;
  webSocketBytesReceived: number;
  /** Receive times (ms after `mark()`), first/last frame and the largest. */
  webSocketFirstFrameMs: number;
  webSocketLastFrameMs: number;
  webSocketLargestFrames: { bytes: number; head: string; atMs: number }[];
  /** Per RPC method: calls, reply bytes, first request and last reply (ms after the click). */
  rpcs: {
    method: string;
    calls: number;
    bytes: number;
    firstSentMs: number;
    lastDoneMs: number;
    maxCallMs: number;
  }[];
}

interface RequestEvent {
  requestId: string;
  timestamp: number;
  request: { url: string; method: string; postData?: string };
}
interface FinishedEvent {
  requestId: string;
  timestamp: number;
  encodedDataLength: number;
}
interface FrameEvent {
  response?: { payloadData?: string };
}

export class NetworkCapture {
  private readonly requests = new Map<
    string,
    { url: string; method: string; start: number; end?: number; bytes: number }
  >();
  private sent = 0;
  private received = 0;
  private receivedBytes = 0;
  private requestBytes = 0;
  private offs: (() => void)[] = [];
  private markedAt = Date.now();
  private frames: { at: number; bytes: number; head: string }[] = [];
  private rpc = new Map<
    string,
    {
      method: string;
      sentMs: number;
      doneMs: number;
      bytes: number;
      frames: number;
    }
  >();

  /** Sets the zero point for frame times (call right before the click). */
  mark(): void {
    this.markedAt = Date.now();
    this.frames = [];
    this.rpc = new Map();
  }

  /** `disabled` skips Network events: CDP copies every WebSocket frame, which adds main-thread cost. */
  constructor(
    private readonly cdp: Cdp,
    private readonly disabled = false,
  ) {}

  async start(): Promise<void> {
    if (this.disabled) return;
    await this.cdp.send("Network.enable");
    this.offs.push(
      this.cdp.on("Network.requestWillBeSent", (p: RequestEvent) => {
        this.requests.set(p.requestId, {
          url: p.request.url,
          method: p.request.method,
          start: p.timestamp,
          bytes: 0,
        });
        this.requestBytes += (p.request.postData ?? "").length;
      }),
      this.cdp.on("Network.loadingFinished", (p: FinishedEvent) => {
        const r = this.requests.get(p.requestId);
        if (r) {
          r.end = p.timestamp;
          r.bytes = p.encodedDataLength;
        }
      }),
      this.cdp.on("Network.webSocketFrameSent", (p: FrameEvent) => {
        this.sent++;
        const text = String(p.response?.payloadData ?? "");
        const id = /^\{"protocol":"nerve","version":1,"id":"([^"]+)"/.exec(
          text,
        )?.[1];
        const method = /"data":\{"method":"([^"]+)"/.exec(text)?.[1];
        if (id && method)
          this.rpc.set(id, {
            method,
            sentMs: Date.now() - this.markedAt,
            doneMs: 0,
            bytes: 0,
            frames: 0,
          });
      }),
      this.cdp.on("Network.webSocketFrameReceived", (p: FrameEvent) => {
        const text = String(p.response?.payloadData ?? "");
        const bytes = text.length;
        this.received++;
        this.receivedBytes += bytes;
        const at = Date.now() - this.markedAt;
        this.frames.push({
          at,
          bytes,
          head:
            bytes > 100_000
              ? text.slice(0, 700).replace(/"(source|target)":\{[^}]*\},?/g, "")
              : "",
        });
        const replyTo = /"replyTo":"([^"]+)"/.exec(text.slice(0, 2000))?.[1];
        const entry = replyTo ? this.rpc.get(replyTo) : undefined;
        if (entry) {
          entry.doneMs = at;
          entry.bytes += bytes;
          entry.frames++;
        }
      }),
    );
  }

  private aggregateRpcs(): NetworkSummary["rpcs"] {
    const byMethod = new Map<string, NetworkSummary["rpcs"][number]>();
    for (const r of this.rpc.values()) {
      if (r.frames === 0) continue;
      const entry = byMethod.get(r.method) ?? {
        method: r.method,
        calls: 0,
        bytes: 0,
        firstSentMs: r.sentMs,
        lastDoneMs: 0,
        maxCallMs: 0,
      };
      entry.calls++;
      entry.bytes += r.bytes;
      entry.firstSentMs = Math.min(entry.firstSentMs, r.sentMs);
      entry.lastDoneMs = Math.max(entry.lastDoneMs, r.doneMs);
      entry.maxCallMs = Math.max(entry.maxCallMs, r.doneMs - r.sentMs);
      byMethod.set(r.method, entry);
    }
    return [...byMethod.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  }

  stop(): NetworkSummary {
    void this.cdp.send("Network.disable");
    for (const off of this.offs) off();
    this.offs = [];
    const finished = [...this.requests.values()].filter(
      (r) => r.end !== undefined,
    );
    const durations = finished.map((r) => (r.end! - r.start) * 1000);
    return {
      requests: this.requests.size,
      responseBytes: finished.reduce((sum, r) => sum + r.bytes, 0),
      requestBytes: this.requestBytes,
      totalDurationMs: round(durations.reduce((a, b) => a + b, 0)),
      slowest: finished
        .map((r) => ({
          url: r.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 100),
          ms: round((r.end! - r.start) * 1000),
          bytes: r.bytes,
          method: r.method,
        }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 8),
      webSocketFramesSent: this.sent,
      webSocketFramesReceived: this.received,
      webSocketBytesReceived: this.receivedBytes,
      webSocketFirstFrameMs: this.frames[0]?.at ?? 0,
      webSocketLastFrameMs: this.frames.at(-1)?.at ?? 0,
      webSocketLargestFrames: [...this.frames]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 3)
        .map((f) => ({ bytes: f.bytes, head: f.head, atMs: f.at })),
      rpcs: this.aggregateRpcs(),
    };
  }
}
