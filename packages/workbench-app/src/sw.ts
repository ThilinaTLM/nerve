/// <reference lib="webworker" />

import type { PushPayload } from "@nervekit/contracts/access";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import {
  openConversationUrl,
  OPEN_CONVERSATION_MESSAGE,
} from "./lib/platform/push/open-link";
import { pushNotificationContent } from "./lib/platform/push/push-notification-text";

declare const self: ServiceWorkerGlobalScope;

/*
 * Precache + app-shell navigation (what generateSW produced), plus Web Push.
 * Updates follow the 'prompt' flow: a new worker waits until the app posts
 * SKIP_WAITING (registerSW's updateServiceWorker).
 */

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Serve the cached app shell for in-app navigations, but never hijack the CA
// download, the mobile setup page, or the dynamic API/WS endpoints.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [
      /^\/api\//,
      /^\/html-preview\//,
      /^\/ws\b/,
      /^\/mobile-setup\b/,
      /^\/nerve-local-ca\.pem$/,
    ],
  }),
);

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  if (!payload) return;
  const content = pushNotificationContent(payload);
  event.waitUntil(
    self.registration.showNotification(content.title, {
      body: content.body,
      tag: content.tag,
      renotify: true,
      icon: "/pwa-192x192.png",
      data: { conversationId: content.openConversationId },
    } as NotificationOptions),
  );
});

const ATTENTION_REASONS = new Set([
  "input",
  "finished",
  "failed",
  "interrupted",
]);

/**
 * A light shape check instead of the contract's zod schema, which would
 * bundle zod into the worker. The daemon is the only sender.
 */
function parsePayload(event: PushEvent): PushPayload | undefined {
  let value: unknown;
  try {
    value = event.data?.json();
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const payload = value as Record<string, unknown>;
  if (payload.type === "test") return { type: "test" };
  if (
    payload.type === "attention" &&
    typeof payload.conversationId === "string" &&
    typeof payload.openConversationId === "string" &&
    typeof payload.conversationTitle === "string" &&
    ATTENTION_REASONS.has(payload.reason as string)
  )
    return payload as PushPayload;
  return undefined;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const conversationId = (
    event.notification.data as { conversationId?: string } | undefined
  )?.conversationId;
  event.waitUntil(openApp(conversationId));
});

async function openApp(conversationId: string | undefined): Promise<void> {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const existing = windows.find((client) => "focus" in client);
  if (existing) {
    await (existing as WindowClient).focus();
    if (conversationId) {
      existing.postMessage({
        type: OPEN_CONVERSATION_MESSAGE,
        conversationId,
      });
    }
    return;
  }
  await self.clients.openWindow(
    conversationId ? openConversationUrl(conversationId) : "/",
  );
}
