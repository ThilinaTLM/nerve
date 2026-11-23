import {
  AttentionEdgeTracker,
  conversationTitleToPlainText,
  type AttentionEdge,
  type ConversationSummary,
} from "@nervekit/contracts/core";
import type {
  ClientPresence,
  PushPayload,
  PushState,
  PushSubscriptionData,
} from "@nervekit/contracts/access";
import { sendNotification } from "web-push";
import { ApplicationError } from "../../core/application-error.js";
import { AccessError } from "./access-error.js";
import {
  loadOrCreateVapidKeys,
  VAPID_SUBJECT,
  type VapidKeys,
} from "./push-vapid.js";

/** Same window as the app's `user-stop.ts`. */
export const STOP_SUPPRESSION_MS = 30_000;
/** A push the device cannot receive within a day is no longer news. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

export interface PushSendOptions {
  ttl: number;
  urgency: "normal" | "high";
  vapid: VapidKeys & { subject: string };
}
export type PushSender = (
  subscription: PushSubscriptionData,
  payload: string,
  options: PushSendOptions,
) => Promise<void>;

const sendWithWebPush: PushSender = async (subscription, payload, options) => {
  await sendNotification(subscription, payload, {
    TTL: options.ttl,
    urgency: options.urgency,
    vapidDetails: {
      subject: options.vapid.subject,
      publicKey: options.vapid.publicKey,
      privateKey: options.vapid.privateKey,
    },
  });
};

export interface PushDevices {
  setPushSubscription(
    deviceId: string,
    subscription: PushSubscriptionData,
  ): Promise<boolean>;
  clearPushSubscription(deviceId: string): Promise<void>;
  pushSubscription(deviceId: string): Promise<PushSubscriptionData | undefined>;
  subscribedDevices(): Promise<
    Array<{ deviceId: string; subscription: PushSubscriptionData }>
  >;
}

/** What the service reads from the conversation core. */
export interface PushConversationSource {
  subscribe(
    listener: (change: {
      kind: string;
      summary?: ConversationSummary;
      conversationId?: string;
    }) => void,
  ): () => void;
  /** Every root conversation summary right now (the quiet baseline). */
  listSummaries(): ConversationSummary[];
  projectName(projectId: string): string | undefined;
}

export interface PushServiceOptions {
  devices: PushDevices;
  vapidKeysPath: string;
  send?: PushSender;
  now?: () => number;
  logger?: { warn(message: string): void };
}

/**
 * Web Push for paired devices: pushes the attention edges the app shows, but
 * only while no connected client is active or muted. Payloads carry no
 * transcript content.
 */
export class PushService {
  readonly #devices: PushDevices;
  readonly #send: PushSender;
  readonly #inflight = new Set<Promise<void>>();
  readonly #now: () => number;
  readonly #logger: { warn(message: string): void } | undefined;
  readonly #vapidPath: string;
  readonly #presence = new Map<string, ClientPresence>();
  readonly #stops = new Map<string, number>();
  readonly #tracker = new AttentionEdgeTracker((id) => this.#consumeStop(id));
  #vapid: Promise<VapidKeys> | undefined;
  #source: PushConversationSource | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(options: PushServiceOptions) {
    this.#devices = options.devices;
    this.#vapidPath = options.vapidKeysPath;
    this.#send = options.send ?? sendWithWebPush;
    this.#now = options.now ?? Date.now;
    this.#logger = options.logger;
  }

  #keys(): Promise<VapidKeys> {
    this.#vapid ??= loadOrCreateVapidKeys(this.#vapidPath).catch((error) => {
      this.#vapid = undefined;
      throw error;
    });
    return this.#vapid;
  }

  // ---- device subscription ----------------------------------------------

  async state(deviceId: string): Promise<PushState> {
    return {
      publicKey: (await this.#keys()).publicKey,
      subscribed:
        (await this.#devices.pushSubscription(deviceId)) !== undefined,
    };
  }

  async subscribe(
    deviceId: string,
    subscription: PushSubscriptionData,
  ): Promise<PushState> {
    if (!(await this.#devices.setPushSubscription(deviceId, subscription)))
      throw new AccessError(404, "DEVICE_NOT_FOUND", "Device not found.");
    return this.state(deviceId);
  }

  async unsubscribe(deviceId: string): Promise<PushState> {
    await this.#devices.clearPushSubscription(deviceId);
    return this.state(deviceId);
  }

  /** Sends `{type:"test"}` to one device; failures are reported to the caller. */
  async sendTest(deviceId: string): Promise<void> {
    const subscription = await this.#devices.pushSubscription(deviceId);
    if (!subscription)
      throw new ApplicationError(
        409,
        "PUSH_NOT_SUBSCRIBED",
        "Push is not enabled.",
      );
    try {
      await this.#deliver(subscription, { type: "test" }, "normal");
    } catch (error) {
      if (isGone(error)) await this.#devices.clearPushSubscription(deviceId);
      throw new ApplicationError(
        502,
        "PUSH_FAILED",
        isGone(error)
          ? "The push service dropped this subscription. Enable push again."
          : "The push service rejected the notification.",
      );
    }
  }

  // ---- presence and Stop ------------------------------------------------

  /** Latest report of one connected client; `releaseOwner` ends it. */
  reportPresence(owner: string, presence: ClientPresence): void {
    this.#presence.set(owner, presence);
  }

  releaseOwner(owner: string): void {
    this.#presence.delete(owner);
  }

  /** The user pressed Stop: the next finished/interrupted edge is silent. */
  noteUserStop(conversationId: string): void {
    this.#stops.set(conversationId, this.#now() + STOP_SUPPRESSION_MS);
  }

  #consumeStop(conversationId: string): boolean {
    const until = this.#stops.get(conversationId);
    if (until === undefined) return false;
    this.#stops.delete(conversationId);
    return until >= this.#now();
  }

  #anyoneWatching(): boolean {
    for (const { active, muted } of this.#presence.values())
      if (active || muted) return true;
    return false;
  }

  // ---- attention --------------------------------------------------------

  /** Seed the quiet baseline and follow summaries; returns the disposer. */
  start(source: PushConversationSource): () => void {
    this.stop();
    this.#source = source;
    this.#tracker.seed(source.listSummaries());
    this.#unsubscribe = source.subscribe((change) => {
      if (change.kind === "conversation_changed" && change.summary)
        this.#observe(change.summary);
      else if (change.kind === "conversation_deleted" && change.conversationId)
        this.#tracker.forget(change.conversationId);
    });
    return () => this.stop();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#source = undefined;
  }

  #observe(summary: ConversationSummary): void {
    const edge = this.#tracker.observe(summary);
    if (!edge || this.#anyoneWatching()) return;
    const dispatch = this.#push(summary, edge)
      .catch((error: unknown) => this.#warn("Push dispatch failed", error))
      .finally(() => this.#inflight.delete(dispatch));
    this.#inflight.add(dispatch);
  }

  /** Resolves once every push dispatched so far has been delivered or dropped. */
  async settled(): Promise<void> {
    while (this.#inflight.size) await Promise.all(this.#inflight);
  }

  async #push(
    summary: ConversationSummary,
    edge: AttentionEdge,
  ): Promise<void> {
    const targets = await this.#devices.subscribedDevices();
    if (targets.length === 0) return;
    const asking = edge.kind === "input" ? summary.pendingInput : null;
    const subAgent = asking && asking.conversationId !== summary.id;
    const payload: PushPayload = {
      type: "attention",
      conversationId: summary.id,
      openConversationId: asking?.conversationId ?? summary.id,
      reason: edge.kind,
      inputKind: edge.inputKind,
      conversationTitle: conversationTitleToPlainText(summary.title),
      projectName: this.#source?.projectName(summary.projectId),
      subAgentTitle: subAgent
        ? conversationTitleToPlainText(asking.conversationTitle)
        : undefined,
    };
    const urgency =
      edge.kind === "input" || edge.kind === "failed" ? "high" : "normal";
    await Promise.all(
      targets.map(async ({ deviceId, subscription }) => {
        try {
          await this.#deliver(subscription, payload, urgency);
        } catch (error) {
          if (isGone(error))
            await this.#devices.clearPushSubscription(deviceId);
          else this.#warn("Push delivery failed", error);
        }
      }),
    );
  }

  async #deliver(
    subscription: PushSubscriptionData,
    payload: PushPayload,
    urgency: PushSendOptions["urgency"],
  ): Promise<void> {
    const vapid = { ...(await this.#keys()), subject: VAPID_SUBJECT };
    await this.#send(subscription, JSON.stringify(payload), {
      ttl: PUSH_TTL_SECONDS,
      urgency,
      vapid,
    });
  }

  /** Logs the failure class only: errors from push services can echo the endpoint. */
  #warn(message: string, error: unknown): void {
    const status = (error as { statusCode?: number }).statusCode;
    this.#logger?.warn(
      status === undefined ? message : `${message} (HTTP ${status})`,
    );
  }
}

/** 404/410: the push service forgot the subscription for good. */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
}
