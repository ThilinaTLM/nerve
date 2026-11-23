<!--
  The host side of one extension frame: a sandboxed iframe plus its bridge.

  The frame has an opaque origin, so it is identified by its window: only messages whose
  source is this iframe's `contentWindow` are read, each is validated against the contract and
  the contribution that owns the frame, and every request is answered exactly once. Methods
  that draw UI or touch app state (dialogs, menus, toasts, tabs, composer, tab state) are
  answered here; the rest go to the daemon as `extensions.ui.<method>`.
-->
<script lang="ts">
import { onDestroy, tick, untrack } from "svelte";
import {
  bridgeInitSchema,
  bridgeProtocolVersion,
  type BridgeAnchor,
  type BridgeJson,
  type BridgeMenuEntry,
  type BridgeMethodName,
  type BridgeMode,
  type BridgeParams,
  type BridgeResult,
} from "@nervekit/contracts/extensions";
import type { AnchorRect } from "@nervekit/ui-kit/components/composites/context-menu-list";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import {
  writeClipboardImage,
  writeClipboardText,
} from "@nervekit/ui-kit/browser/clipboard";
import { notify } from "@nervekit/ui-kit/browser/notifications";
import ExtensionMenuOverlay from "./ExtensionMenuOverlay.svelte";
import ExtensionPickOverlay from "./ExtensionPickOverlay.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import { extensionThemeState } from "$lib/platform/appearance/extension-themes.svelte";
import {
  reportExtensionFrameError,
  requestExtensionUiMethod,
  type ExtensionFrameScope,
} from "../api/extension-ui.api";
import {
  errorResponse,
  eventMessage,
  failureOf,
  okResponse,
  routeFrameMessage,
  HostFailure,
  type FrameContribution,
} from "../model/bridge-router";
import { base64ToBlob } from "../model/clipboard-image";
import { anchorInApp } from "../model/host-overlay";
import { FrameErrorGate } from "../model/frame-errors";
import { currentThemeSnapshot } from "../model/theme-snapshot";
import { TabStateStore, tabStateKey } from "../model/tab-state-store";
import { extensionHostActions } from "../state/host-actions";

let {
  projectId,
  extensionId,
  extensionName,
  extensionIconName,
  contribution,
  frameUrl,
  baseCssUrl,
  title,
  instance,
  filePath,
  mode = "preview",
  pageParams,
  onOpenPage,
  onFileWritten,
}: {
  projectId: string;
  extensionId: string;
  extensionName: string;
  /** The extension's icon (a lucide name), shown on the pickers the host draws for it. */
  extensionIconName?: string;
  contribution: FrameContribution;
  frameUrl: string;
  baseCssUrl: string;
  title: string;
  /** Identifies this tab or panel for its persisted tab state. */
  instance: string;
  /** Previews: the project file the tab is opened on. */
  filePath?: string;
  /** Previews with `edit: "custom"`: whether the frame shows the file or edits it. */
  mode?: BridgeMode;
  /** Pages: the params the tab was opened with. */
  pageParams?: BridgeJson;
  /** Opens one of this extension's pages; `false` when it has no such page. */
  onOpenPage?: (id: string, params?: BridgeJson) => boolean;
  /** The frame wrote the file through the bridge. */
  onFileWritten?: (size: number) => void;
} = $props();

const tabStates = new TabStateStore(
  typeof localStorage === "undefined" ? undefined : localStorage,
);
const loadTimeoutMs = 15_000;

// Names this frame instance in store requests so it can skip its own `extensions.store.changed`.
const storeOrigin = crypto.randomUUID();
const frameErrors = new FrameErrorGate();

let frame = $state<HTMLIFrameElement>();
let ready = $state(false);
let failed = $state(false);
let reloadKey = $state(0);

const src = $derived(new URL(frameUrl, window.location.origin).href);
const scope = $derived<ExtensionFrameScope>({
  projectId,
  extensionId,
  contribution: { kind: contribution.kind, id: contribution.id },
  filePath,
});
const stateKey = $derived(
  tabStateKey({
    projectId,
    extensionId,
    kind: contribution.kind,
    contributionId: contribution.id,
    instance,
  }),
);
// Only a preview with a custom editor ever edits; everywhere else the mode is `preview`.
const effectiveMode = $derived<BridgeMode>(
  contribution.kind === "preview" && contribution.edit === "custom"
    ? mode
    : "preview",
);

// A frame that never says ready is broken or blocked; offer a retry instead of a blank pane.
$effect(() => {
  void reloadKey;
  frameErrors.reset();
  ready = false;
  failed = false;
  const timer = setTimeout(() => {
    if (!ready) failed = true;
  }, loadTimeoutMs);
  return () => clearTimeout(timer);
});

function post(message: unknown): void {
  frame?.contentWindow?.postMessage(message, "*");
}

function postEvent(
  event: "theme.changed" | "file.changed" | "mode.changed" | "store.changed",
  data: unknown,
) {
  const message = eventMessage(event, data, contribution.kind);
  if (message) post(message);
}

function sendInit(): void {
  const theme = currentThemeSnapshot(document.documentElement);
  const init = bridgeInitSchema.safeParse({
    nerveBridge: bridgeProtocolVersion,
    type: "init",
    contribution: {
      kind: contribution.kind,
      id: contribution.id,
      edit: contribution.edit,
    },
    extensionId,
    mode: effectiveMode,
    themeKind: theme.kind,
    tokensCss: theme.tokensCss,
    baseCssUrl: new URL(baseCssUrl, window.location.origin).href,
    pageParams,
  });
  if (!init.success) {
    failed = true;
    return;
  }
  post(init.data);
  ready = true;
}

// ── Host-drawn UI ────────────────────────────────────────────────────────

type ConfirmParams = BridgeParams<"ui.confirm">;
type Overlay =
  | {
      kind: "confirm";
      params: ConfirmParams;
      resolve: (value: boolean) => void;
    }
  | {
      kind: "menu";
      entries: BridgeMenuEntry[];
      anchor: { getBoundingClientRect(): AnchorRect };
      resolve: (value: string | null) => void;
    }
  | {
      kind: "pick";
      params: BridgeParams<"ui.pick">;
      anchor: { getBoundingClientRect(): AnchorRect };
      resolve: (value: string[] | null) => void;
    };
// The one host-drawn overlay of this frame. Its backdrop covers the app, so no other frame can
// open one meanwhile; a second request from this frame is `cancelled`.
let overlay = $state.raw<Overlay>();

/** Menus, pickers and dialogs answer a click or key press, never a script that runs on its own. */
function requireGesture(what: string): void {
  if (!navigator.userActivation?.isActive)
    throw new HostFailure(
      "not_allowed",
      `Show ${what} only in response to a click or key press`,
    );
}

function showOverlay<T>(
  what: string,
  create: (resolve: (value: T) => void) => Overlay,
): Promise<T> {
  requireGesture(what);
  if (overlay) throw new HostFailure("cancelled", "Another request is open");
  return new Promise<T>((resolve) => {
    overlay = create(resolve as never);
  });
}

/** Ends the overlay with the user's answer, once, and gives the keyboard back to the frame. */
function settle<T extends Overlay["kind"]>(
  kind: T,
  value: Parameters<Extract<Overlay, { kind: T }>["resolve"]>[0],
): void {
  const current = overlay;
  if (current?.kind !== kind) return;
  overlay = undefined;
  (current.resolve as (value: unknown) => void)(value);
  // The menu or list closes first; then the frame's own focused element takes keys again.
  setTimeout(() => frame?.contentWindow?.focus(), 0);
}

function frameAnchor(anchor: BridgeAnchor | undefined) {
  return {
    getBoundingClientRect: () =>
      anchorInApp(frame?.getBoundingClientRect() ?? emptyRect, anchor),
  };
}
const emptyRect = { left: 0, top: 0, width: 0, height: 0 };

// A frame that goes away (tab closed, reload) cannot answer: end its overlay as dismissed.
onDestroy(() => {
  const current = overlay;
  overlay = undefined;
  if (current?.kind === "confirm") current.resolve(false);
  else (current?.resolve as ((value: null) => void) | undefined)?.(null);
});

function notifyUser(params: BridgeParams<"ui.notify">): void {
  const options = { description: extensionName };
  if (params.level === "success") notify.success(params.message, options);
  else if (params.level === "error") notify.error(params.message, options);
  else notify.message(params.message, options);
}

// ── Clipboard ────────────────────────────────────────────────────────────

/** Copying needs the user's click to still be active; the frame's click activates this window. */
async function copyToClipboard(
  method: "clipboard.writeText" | "clipboard.writeImage",
  params: unknown,
): Promise<void> {
  if (!navigator.userActivation?.isActive)
    throw new HostFailure("not_allowed", "Copy only in response to a click");
  try {
    if (method === "clipboard.writeText") {
      await writeClipboardText((params as BridgeParams<typeof method>).text);
      return;
    }
    const image = params as BridgeParams<"clipboard.writeImage">;
    const blob = base64ToBlob(image.dataBase64, image.mediaType);
    if (!blob)
      throw new HostFailure("invalid_request", "The image is not valid base64");
    await writeClipboardImage(blob);
  } catch (error) {
    if (error instanceof HostFailure) throw error;
    throw new HostFailure(
      "failed",
      error instanceof Error ? error.message : "Copy failed",
    );
  }
}

// ── Requests ─────────────────────────────────────────────────────────────

async function hostRequest(
  method: BridgeMethodName,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "tabState.get":
      return {
        state: tabStates.get(stateKey),
      } satisfies BridgeResult<"tabState.get">;
    case "tabState.set":
      if (!tabStates.set(stateKey, (params as { state: BridgeJson }).state))
        throw new HostFailure("too_large", "The tab state is too large");
      return {};
    case "ui.confirm":
      return {
        confirmed: await showOverlay<boolean>("a dialog", (resolve) => ({
          kind: "confirm",
          params: params as ConfirmParams,
          resolve,
        })),
      } satisfies BridgeResult<"ui.confirm">;
    case "ui.menu": {
      const request = params as BridgeParams<"ui.menu">;
      return {
        id: await showOverlay<string | null>("a menu", (resolve) => ({
          kind: "menu",
          entries: request.entries,
          anchor: frameAnchor(request.anchor),
          resolve,
        })),
      } satisfies BridgeResult<"ui.menu">;
    }
    case "ui.pick": {
      const request = params as BridgeParams<"ui.pick">;
      return {
        ids: await showOverlay<string[] | null>("a list", (resolve) => ({
          kind: "pick",
          params: request,
          anchor: frameAnchor(request.anchor),
          resolve,
        })),
      } satisfies BridgeResult<"ui.pick">;
    }
    case "ui.notify":
      notifyUser(params as BridgeParams<"ui.notify">);
      return {};
    case "workspace.openFile":
      await extensionHostActions().openFile(
        projectId,
        (params as BridgeParams<"workspace.openFile">).path,
      );
      return {};
    case "pages.open": {
      const request = params as { id: string; params?: BridgeJson };
      const { id } = request;
      if (!onOpenPage?.(id, request.params))
        throw new HostFailure("not_found", `This extension has no page ${id}`);
      return {};
    }
    case "chat.insert":
      extensionHostActions().insertIntoComposer(
        (params as BridgeParams<"chat.insert">).text,
      );
      return {};
    case "clipboard.writeText":
    case "clipboard.writeImage":
      await copyToClipboard(method, params);
      return {};
    default:
      throw new HostFailure("unknown_method", `Unknown method ${method}`);
  }
}

async function serverRequest(
  method: BridgeMethodName,
  params: unknown,
): Promise<unknown> {
  if (method === "file.write" && effectiveMode !== "edit")
    throw new HostFailure(
      "not_allowed",
      "The file can only be written in edit mode",
    );
  // Like copying: starting a conversation needs the user's click to still be active.
  if (
    method === "chat.startConversation" &&
    !navigator.userActivation?.isActive
  )
    throw new HostFailure(
      "not_allowed",
      "Start a conversation only in response to a click",
    );
  const result = await requestExtensionUiMethod(
    method as Parameters<typeof requestExtensionUiMethod>[0],
    scope,
    params,
    storeOrigin,
  );
  if (method === "chat.startConversation") {
    const start = params as BridgeParams<"chat.startConversation">;
    try {
      await extensionHostActions().conversationStarted(
        projectId,
        (result as BridgeResult<"chat.startConversation">).conversationId,
        {
          open: start.open !== false,
          ...(start.send === false ? { draft: start.prompt } : {}),
        },
      );
    } catch (error) {
      // The conversation exists; the frame still gets its id.
      notify.error(
        error instanceof Error
          ? error.message
          : "The conversation could not be opened",
      );
    }
  }
  if (method === "file.write") {
    const size = (result as BridgeResult<"file.write">).size;
    void refreshKnownStat();
    onFileWritten?.(size);
  }
  return result;
}

async function answer(
  id: string,
  method: BridgeMethodName,
  handler: "host" | "server",
  params: unknown,
): Promise<void> {
  try {
    const result =
      handler === "host"
        ? await hostRequest(method, params)
        : await serverRequest(method, params);
    post(okResponse(id, result));
  } catch (error) {
    const failure =
      error instanceof HostFailure
        ? { code: error.code, message: error.message }
        : failureOf(error, method);
    post(errorResponse(id, failure.code, failure.message));
  }
}

function receive(event: MessageEvent): void {
  if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
  const routed = routeFrameMessage(event.data, contribution);
  if (routed.type === "ignore") return;
  if (routed.type === "ready") {
    sendInit();
    void refreshKnownStat();
    return;
  }
  if (routed.type === "frameError") {
    if (frameErrors.accept(routed.error))
      void reportExtensionFrameError(scope, routed.error).catch(() => {});
    return;
  }
  if (routed.type === "reject") {
    post(errorResponse(routed.id, routed.error.code, routed.error.message));
    return;
  }
  void answer(routed.id, routed.method, routed.handler, routed.params);
}

// ── Events to the frame ──────────────────────────────────────────────────

// The app theme changed: send the new tokens once the document has applied them.
$effect(() => {
  void appearanceState.theme;
  void extensionThemeState.cards;
  if (!untrack(() => ready)) return;
  void tick().then(() =>
    postEvent("theme.changed", currentThemeSnapshot(document.documentElement)),
  );
});

let lastMode = untrack(() => effectiveMode);
$effect(() => {
  const next = effectiveMode;
  if (next === lastMode) return;
  lastMode = next;
  if (untrack(() => ready)) postEvent("mode.changed", { mode: next });
});

// Files: the daemon's directory-change events are the signal; compare the file's stat to tell
// a change to this file from its neighbours.
let knownStat: string | undefined;
let statTimer: ReturnType<typeof setTimeout> | undefined;

async function readStat(): Promise<
  { size: number; modifiedAt?: string } | undefined
> {
  try {
    const info = (await requestExtensionUiMethod(
      "file.info",
      scope,
      {},
    )) as BridgeResult<"file.info">;
    return { size: info.size, modifiedAt: info.modifiedAt };
  } catch {
    return undefined;
  }
}

async function refreshKnownStat(): Promise<void> {
  if (contribution.kind !== "preview" || !filePath) return;
  const stat = await readStat();
  if (stat) knownStat = JSON.stringify(stat);
}

async function checkFileChanged(): Promise<void> {
  const stat = await readStat();
  if (!stat) return;
  const serialized = JSON.stringify(stat);
  if (serialized === knownStat) return;
  knownStat = serialized;
  postEvent("file.changed", stat);
}

$effect(() => {
  const path = filePath;
  if (contribution.kind !== "preview" || !path) return;
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parent = separator >= 0 ? path.slice(0, separator) : "";
  const stop = onEvent("filesystem.project.changed", (event) => {
    const data = event.data;
    if (data?.projectId !== projectId || !ready) return;
    const directories = Array.isArray(data.directories)
      ? data.directories.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const root = (directory: string) => directory === "" || directory === ".";
    if (
      data.fullRefreshRequired !== true &&
      !directories.some(
        (directory) =>
          directory === parent || (root(directory) && root(parent)),
      )
    )
      return;
    clearTimeout(statTimer);
    statTimer = setTimeout(() => void checkFileChanged(), 200);
  });
  return () => {
    stop();
    clearTimeout(statTimer);
  };
});

$effect(() =>
  onEvent("extensions.store.changed", (event) => {
    const data = event.data;
    if (
      !ready ||
      data?.projectId !== projectId ||
      data.extensionId !== extensionId ||
      data.origin === storeOrigin
    )
      return;
    postEvent("store.changed", {
      key: data.key,
      revision: data.revision,
    });
  }),
);

function reload(): void {
  reloadKey += 1;
}
</script>

<svelte:window onmessage={receive} />

<div class="relative h-full min-h-0 w-full bg-background">
  {#key reloadKey}
    <iframe
      bind:this={frame}
      {src}
      {title}
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      class="block h-full w-full border-0"
    ></iframe>
  {/key}
  {#if !ready}
    <div
      class="absolute inset-0 grid place-content-center gap-2 bg-background p-4 text-center text-ui text-muted-foreground"
    >
      {#if failed}
        <p class="m-0">{extensionName} did not respond.</p>
        <Button variant="outline" onclick={reload}>Retry</Button>
      {:else}
        <Spinner class="mx-auto size-5" />
      {/if}
    </div>
  {/if}
</div>

{#if overlay?.kind === "confirm"}
  {@const request = overlay}
  {#key request}
    <ConfirmDialog
      open={true}
      title={request.params.title}
      description={`${request.params.message ?? ""}${request.params.message ? "\n\n" : ""}From ${extensionName}`}
      confirmLabel={request.params.confirmLabel ?? "Confirm"}
      cancelLabel={request.params.cancelLabel ?? "Cancel"}
      destructive={request.params.destructive}
      onConfirm={() => settle("confirm", true)}
      onCancel={() => settle("confirm", false)}
      onOpenChange={(open) => {
        if (!open) settle("confirm", false);
      }}
    />
  {/key}
{:else if overlay?.kind === "menu"}
  {@const request = overlay}
  {#key request}
    <ExtensionMenuOverlay
      {extensionName}
      {extensionIconName}
      entries={request.entries}
      anchor={request.anchor}
      onSettle={(id) => settle("menu", id)}
    />
  {/key}
{:else if overlay?.kind === "pick"}
  {@const request = overlay}
  {#key request}
    <ExtensionPickOverlay
      {extensionName}
      {extensionIconName}
      params={request.params}
      anchor={request.anchor}
      onSettle={(ids) => settle("pick", ids)}
    />
  {/key}
{/if}
