import type {
  HelloData,
  NerveMessage,
  PeerDescriptor,
  ProtocolLimits,
  ProtocolV1Message,
  StreamCursor,
  StreamState,
  WelcomeData,
} from "@nervekit/contracts";
import type { MessageFactory } from "./messages.js";

export type ClientSessionState =
  | "idle"
  | "hello_sent"
  | "ready"
  | "closing"
  | "closed";

export interface ClientSessionOptions {
  readonly createMessage: MessageFactory;
  readonly capabilities?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly cursors?: () => readonly StreamCursor[];
  readonly sessionId?: () => string | undefined;
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly onMessage?: (message: ProtocolV1Message) => void | Promise<void>;
  readonly onReady?: (welcome: WelcomeData) => void | Promise<void>;
  readonly onSnapshotRequired?: (welcome: WelcomeData) => void | Promise<void>;
}

export class ProtocolClientSession {
  state: ClientSessionState = "idle";
  sessionId?: string;
  readonly #options: ClientSessionOptions;

  constructor(options: ClientSessionOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "closed") {
      throw new Error(`Cannot start a client session from ${this.state}`);
    }
    const previousSessionId = this.#options.sessionId?.();
    const streams = this.#options.cursors?.();
    const data: HelloData = {
      requestedVersion: 1,
      capabilities: [...(this.#options.capabilities ?? [])],
      requiredCapabilities: this.#options.requiredCapabilities
        ? [...this.#options.requiredCapabilities]
        : undefined,
      encodings: ["json"],
      resume:
        previousSessionId || streams?.length
          ? {
              sessionId: previousSessionId,
              streams: streams ? [...streams] : undefined,
            }
          : undefined,
    };
    this.state = "hello_sent";
    await this.#options.send(this.#options.createMessage("hello", data));
  }

  async receive(message: ProtocolV1Message): Promise<void> {
    if (this.state === "hello_sent") {
      if (message.kind === "error") {
        this.state = "closed";
        await this.#options.onMessage?.(message);
        return;
      }
      if (message.kind !== "welcome") {
        throw new SessionStateError(
          "Expected welcome as the first server message",
        );
      }
      const welcome = message.data;
      const missing = (this.#options.requiredCapabilities ?? []).filter(
        (capability) => !welcome.capabilities.includes(capability),
      );
      if (missing.length > 0) {
        this.state = "closed";
        throw new SessionStateError(
          `Server did not negotiate required capabilities: ${missing.join(", ")}`,
        );
      }
      this.sessionId = welcome.sessionId;
      await this.#options.send(
        this.#options.createMessage("ready", {
          sessionId: welcome.sessionId,
          streams: this.#options.cursors?.() as StreamCursor[] | undefined,
        }),
      );
      this.state = "ready";
      if (welcome.resume.mode === "snapshot_required") {
        await this.#options.onSnapshotRequired?.(welcome);
      }
      await this.#options.onReady?.(welcome);
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
    }
    await this.#options.onMessage?.(message);
  }

  async close(
    reason: "client_closing" | "protocol_error" = "client_closing",
  ): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closing";
    await this.#options.send(
      this.#options.createMessage("goodbye", {
        sessionId: this.sessionId,
        reason,
        finalCursors: this.#options.cursors?.() as StreamCursor[] | undefined,
      }),
    );
    this.state = "closed";
  }
}

export type ServerSessionState =
  | "awaiting_hello"
  | "awaiting_ready"
  | "ready"
  | "closing"
  | "closed";

export interface SessionResumeDecision {
  readonly accepted: boolean;
  readonly mode: "live" | "replay" | "snapshot_required" | "fresh";
  readonly reason?: string;
}

export interface ServerSessionOptions {
  readonly acceptingPeer: PeerDescriptor;
  readonly createMessage: MessageFactory;
  readonly capabilities?: readonly string[];
  readonly streams: () => readonly StreamState[];
  readonly limits: ProtocolLimits;
  readonly heartbeat: {
    readonly intervalMs: number;
    readonly timeoutMs: number;
  };
  readonly resume?: (
    hello: HelloData,
    source: PeerDescriptor,
  ) => SessionResumeDecision | Promise<SessionResumeDecision>;
  readonly sessionId: () => string;
  readonly send: (message: NerveMessage) => void | Promise<void>;
  readonly onReady?: (
    message: ProtocolV1Message & { kind: "ready" },
  ) => void | Promise<void>;
  readonly onMessage?: (message: ProtocolV1Message) => void | Promise<void>;
}

export class ProtocolServerSession {
  state: ServerSessionState = "awaiting_hello";
  sessionId?: string;
  peer?: PeerDescriptor;
  readonly #options: ServerSessionOptions;

  constructor(options: ServerSessionOptions) {
    this.#options = options;
  }

  async receive(message: ProtocolV1Message): Promise<void> {
    if (this.state === "awaiting_hello") {
      if (message.kind !== "hello") {
        throw new SessionStateError("hello must be the first client message");
      }
      this.peer = message.source;
      const unsupportedRequired = (
        message.data.requiredCapabilities ?? []
      ).filter(
        (capability) =>
          !(this.#options.capabilities ?? []).includes(capability),
      );
      if (unsupportedRequired.length > 0) {
        await this.fail(
          "CAPABILITY_REQUIRED",
          `Unsupported required capabilities: ${unsupportedRequired.join(", ")}`,
        );
        return;
      }
      const decision = (await this.#options.resume?.(
        message.data,
        message.source,
      )) ?? {
        accepted: false,
        mode: "fresh" as const,
      };
      this.sessionId = this.#options.sessionId();
      await this.#options.send(
        this.#options.createMessage(
          "welcome",
          {
            sessionId: this.sessionId,
            acceptingPeer: this.#options.acceptingPeer,
            acceptedVersion: 1,
            capabilities: [...(this.#options.capabilities ?? [])].filter(
              (capability) => message.data.capabilities.includes(capability),
            ),
            encoding: "json",
            streams: [...this.#options.streams()],
            limits: this.#options.limits,
            heartbeat: this.#options.heartbeat,
            resume: decision,
          },
          { target: message.source },
        ),
      );
      this.state = "awaiting_ready";
      return;
    }
    if (this.state === "awaiting_ready") {
      if (
        message.kind !== "ready" ||
        message.data.sessionId !== this.sessionId
      ) {
        throw new SessionStateError("Expected ready for the accepted session");
      }
      this.state = "ready";
      await this.#options.onReady?.(message);
      return;
    }
    if (this.state !== "ready") {
      throw new SessionStateError(
        `Cannot receive ${message.kind} while ${this.state}`,
      );
    }
    if (message.kind === "goodbye") {
      this.state = "closed";
      return;
    }
    await this.#options.onMessage?.(message);
  }

  async fail(
    code: "CAPABILITY_REQUIRED" | "INVALID_MESSAGE" | "UNKNOWN_MESSAGE_KIND",
    message: string,
  ): Promise<void> {
    this.state = "closing";
    await this.#options.send(
      this.#options.createMessage("error", {
        code,
        message,
        retryable: false,
        close: true,
      }),
    );
    this.state = "closed";
  }
}

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStateError";
  }
}
