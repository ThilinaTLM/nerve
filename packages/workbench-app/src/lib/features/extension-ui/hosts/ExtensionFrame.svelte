<!--
  The host side of one extension frame: a sandboxed iframe plus its bridge.

  The frame has an opaque origin, so it is identified by its window: only messages whose
  source is this iframe's `contentWindow` are read, each is validated against the contract and
  the contribution that owns the frame, and every request is answered exactly once. Methods
  that draw UI or touch app state (dialogs, menus, toasts, tabs, composer, view state) are
  answered here; the rest go to the daemon as `extensions.ui.<method>`.
-->
<script lang="ts">
import { tick, untrack } from "svelte";
import {
  bridgeInitSchema,
  bridgeProtocolVersion,
  type BridgeJson,
  type BridgeMethodName,
  type BridgeMode,
  type BridgeParams,
  type BridgeResult,
} from "@nervekit/contracts/extensions";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { notify } from "@nervekit/ui-kit/browser/notifications";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { appearanceState } from "$lib/platform/appearance/appearance.svelte";
import { extensionThemeState } from "$lib/platform/appearance/extension-themes.svelte";
import {
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
import { currentThemeSnapshot } from "../model/theme-snapshot";
import { ViewStateStore, viewStateKey } from "../model/view-state-store";
import { extensionHostActions } from "../state/host-actions";

let {
  projectId,
  extensionId,
  extensionName,
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
  contribution: FrameContribution;
  frameUrl: string;
  baseCssUrl: string;
  title: string;
  /** Identifies this tab or panel for its persisted view state. */
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

const viewStates = new ViewStateStore(
  typeof localStorage === "undefined" ? undefined : localStorage,
);
const loadTimeoutMs = 15_000;

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
  viewStateKey({
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
  event: "themeChanged" | "fileChanged" | "modeChanged",
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
let confirmRequest = $state<{
  params: ConfirmParams;
  resolve: (confirmed: boolean) => void;
}>();
let menuItems = $state<ContextMenuItem[]>([]);
let menuResolve: ((id: string | null) => void) | undefined;
let menuChoice: string | null = null;

function confirm(params: ConfirmParams): Promise<boolean> {
  if (confirmRequest)
    throw new HostFailure("cancelled", "Another confirmation is open");
  return new Promise((resolve) => {
    confirmRequest = { params, resolve };
  });
}

function settleConfirm(confirmed: boolean): void {
  const request = confirmRequest;
  confirmRequest = undefined;
  request?.resolve(confirmed);
}

function showMenu(params: BridgeParams<"ui.showMenu">): Promise<string | null> {
  if (menuResolve) throw new HostFailure("cancelled", "Another menu is open");
  const element = frame;
  if (!element) throw new HostFailure("failed", "The frame is not available");
  return new Promise((resolve) => {
    menuResolve = resolve;
    menuChoice = null;
    menuItems = params.items.map((item) => ({
      label: item.label,
      disabled: item.disabled,
      destructive: item.destructive,
      onSelect: () => {
        menuChoice = item.id;
      },
    }));
    const rect = element.getBoundingClientRect();
    const x = Math.min(Math.max(params.position?.x ?? 0, 0), rect.width);
    const y = Math.min(Math.max(params.position?.y ?? 0, 0), rect.height);
    // The menu list opens from its trigger's `contextmenu` event at the pointer position.
    void tick().then(() =>
      element.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
          button: 2,
        }),
      ),
    );
  });
}

function menuOpenChange(open: boolean): void {
  if (open) return;
  // The item's action runs before the menu reports closed; wait a turn to tell them apart.
  setTimeout(() => {
    const resolve = menuResolve;
    menuResolve = undefined;
    resolve?.(menuChoice);
    menuChoice = null;
  }, 0);
}

function notifyUser(params: BridgeParams<"ui.notify">): void {
  const options = { description: extensionName };
  if (params.level === "success") notify.success(params.message, options);
  else if (params.level === "error") notify.error(params.message, options);
  else notify.message(params.message, options);
}

// ── Requests ─────────────────────────────────────────────────────────────

async function hostRequest(
  method: BridgeMethodName,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "viewState.get":
      return {
        state: viewStates.get(stateKey),
      } satisfies BridgeResult<"viewState.get">;
    case "viewState.set":
      if (!viewStates.set(stateKey, (params as { state: BridgeJson }).state))
        throw new HostFailure("too_large", "The view state is too large");
      return {};
    case "mode.get":
      return { mode: effectiveMode } satisfies BridgeResult<"mode.get">;
    case "ui.confirm":
      return {
        confirmed: await confirm(params as ConfirmParams),
      } satisfies BridgeResult<"ui.confirm">;
    case "ui.showMenu":
      return {
        id: await showMenu(params as BridgeParams<"ui.showMenu">),
      } satisfies BridgeResult<"ui.showMenu">;
    case "ui.notify":
      notifyUser(params as BridgeParams<"ui.notify">);
      return {};
    case "openFile":
      await extensionHostActions().openFile(
        projectId,
        (params as BridgeParams<"openFile">).path,
      );
      return {};
    case "openPage": {
      const request = params as { id: string; params?: BridgeJson };
      const { id } = request;
      if (!onOpenPage?.(id, request.params))
        throw new HostFailure("not_found", `This extension has no page ${id}`);
      return {};
    }
    case "composer.insert":
      extensionHostActions().insertIntoComposer(
        (params as BridgeParams<"composer.insert">).text,
      );
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
  const result = await requestExtensionUiMethod(
    method as Parameters<typeof requestExtensionUiMethod>[0],
    scope,
    params,
  );
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
    postEvent("themeChanged", currentThemeSnapshot(document.documentElement)),
  );
});

let lastMode = untrack(() => effectiveMode);
$effect(() => {
  const next = effectiveMode;
  if (next === lastMode) return;
  lastMode = next;
  if (untrack(() => ready)) postEvent("modeChanged", { mode: next });
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
  postEvent("fileChanged", stat);
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

function reload(): void {
  reloadKey += 1;
}
</script>

<svelte:window onmessage={receive} />

<ContextMenuList
  items={menuItems}
  triggerClass="block h-full min-h-0 w-full min-w-0 flex-1"
  onOpenChange={menuOpenChange}
>
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
</ContextMenuList>

{#if confirmRequest}
  {@const request = confirmRequest}
  {#key request}
    <ConfirmDialog
      open={true}
      title={request.params.title}
      description={`${request.params.message ?? ""}${request.params.message ? "\n\n" : ""}From ${extensionName}`}
      confirmLabel={request.params.confirmLabel ?? "Confirm"}
      cancelLabel={request.params.cancelLabel ?? "Cancel"}
      destructive={request.params.destructive}
      onConfirm={() => settleConfirm(true)}
      onCancel={() => settleConfirm(false)}
      onOpenChange={(open) => {
        if (!open) settleConfirm(false);
      }}
    />
  {/key}
{/if}
