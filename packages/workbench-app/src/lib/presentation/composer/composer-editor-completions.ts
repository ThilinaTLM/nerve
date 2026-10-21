// Suggestion state machine for the prompt editor. It detects the @-mention or
// leading slash token, runs async sources, owns selection/keyboard handling,
// and publishes a plain `PopupModel` that ComposerCompletionPopup.svelte
// renders. Nothing here renders into the editor DOM.
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import {
  ViewPlugin,
  keymap,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  COMPLETION_RESULT_LIMIT,
  COMPLETION_SCOPED_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";
import {
  COMPLETION_SCOPES,
  RECENT_REQUEST_LIMIT,
  buildMentionGroups,
  buildSlashGroups,
  completionScope,
  firstEligibleRow,
  flattenRows,
  loadingState,
  parseMentionScope,
  sourceLabel,
  unavailableFooter,
  type CompletionScopeId,
  type ComposerSearchResponse,
  type ComposerReferenceSource,
  type ComposerCompletionAction,
  type PopupFooter,
  type PopupGroup,
  type PopupModel,
  type PopupRow,
  type SlashContext,
} from "./composer-completion-model";
import {
  insertMentionsTransaction,
  mentionChipsOf,
} from "./composer-mention-chips";

export type {
  ComposerReferenceSource,
  ComposerCompletionAction,
  PopupFooter,
  PopupGroup,
  PopupModel,
  PopupRow,
  SlashContext as ComposerSlashContext,
} from "./composer-completion-model";

export type ComposerCompletionOptions = {
  referenceSource?: () => ComposerReferenceSource | undefined;
  slashCompletions: () => readonly CompletionItem[];
  /** Profile/running state for the slash list. */
  slashContext?: () => SlashContext | undefined;
  /** Runs a slash command now. Without it, slash suggestions are off. */
  slashCommand?: () => ((name: string) => void) | undefined;
  /** Status-bar fix actions (open settings, connect GitHub…). */
  action?: () => ((action: ComposerCompletionAction) => void) | undefined;
  /** Receives the popup model (null = closed). */
  onModel?: (model: PopupModel | null) => void;
  /** Debounce before mention searches; tests set 0. */
  searchDelayMs?: number;
};

/** Empty-state copy: category-specific without a query, quoted with one. */
export function emptyMentionText(
  token: Pick<CompletionToken, "scope" | "query">,
): string {
  if (token.query !== "") return `No matches for “${token.query}”`;
  const scope = completionScope(token.scope);
  return scope
    ? `No ${scope.label.toLowerCase()} to show`
    : "Nothing to suggest yet";
}

const SEARCH_DELAY_MS = 60;
const SHOW_AFTER_MS = 180;
const POPUP_MIN_SPACE = 240;

const generations = new WeakMap<ComposerCompletionOptions, number>();
const generationOf = (options: ComposerCompletionOptions) =>
  generations.get(options) ?? 0;
/** Drop in-flight searches/actions started before a source or input change. */
export function invalidateComposerCompletionRequests(
  options: ComposerCompletionOptions,
): void {
  generations.set(options, generationOf(options) + 1);
}

export type CompletionToken = {
  kind: "mention" | "slash";
  from: number;
  to: number;
  /** Text from the sigil to the caret, e.g. "@pr:42" or "/pla". */
  raw: string;
  scope?: CompletionScopeId;
  /** Length of the typed "pr:" text after the "@" (0 when unscoped). */
  scopeLength: number;
  /** Mention text after the scope, or slash text after "/". */
  query: string;
};

/** Mentions end at whitespace; slash commands only exist at the prompt start. */
export function completionTokenAt(
  state: EditorState,
  slashEnabled: boolean,
): CompletionToken | undefined {
  const range = state.selection.main;
  if (!range.empty) return undefined;
  const head = range.head;
  const line = state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);

  if (slashEnabled && line.number === 1 && /^\/[\w-]*$/.test(before)) {
    return {
      kind: "slash",
      from: 0,
      to: head,
      raw: before,
      scopeLength: 0,
      query: before.slice(1),
    };
  }
  const match = /(?:^|\s)(@[^\s@]*)$/.exec(before);
  if (!match) return undefined;
  const raw = match[1]!;
  const from = head - raw.length;
  // A caret hugging an accepted chip is not a live token.
  if (mentionChipsOf(state).some((chip) => chip.from === from))
    return undefined;
  const parsed = parseMentionScope(raw.slice(1));
  return {
    kind: "mention",
    from,
    to: head,
    raw,
    scope: parsed.scope,
    scopeLength: parsed.scope ? raw.length - 1 - parsed.query.length : 0,
    query: parsed.query,
  };
}

type ViewLike = Pick<EditorView, "state" | "dispatch"> & {
  dom?: HTMLElement;
};

const TYPING_EVENTS = ["input", "delete", "undo", "redo"] as const;
const isTyping = (update: Pick<ViewUpdate, "transactions">) =>
  update.transactions.some((tr) =>
    TYPING_EVENTS.some((event) => tr.isUserEvent(event)),
  );

/** Version mismatch on completion.select surfaces as protocol code CONFLICT. */
export function isCompletionConflict(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    data?: { code?: unknown };
  } | null;
  return candidate?.code === "CONFLICT" || candidate?.data?.code === "CONFLICT";
}

export class ComposerCompletionController {
  private token?: CompletionToken;
  private tokenKey = "";
  private results?: ComposerSearchResponse;
  private loading = false;
  private visible = false;
  private selectedId?: string;
  private dismissedFrom?: number;
  private placement: "above" | "below" = "above";
  private notice?: PopupFooter;
  private noticeItem?: CompletionItem;
  private pending?: {
    id: string;
    source?: ComposerReferenceSource;
    doc: EditorState["doc"];
  };
  private seq = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private showTimer?: ReturnType<typeof setTimeout>;
  private groups: PopupGroup[] = [];
  private destroyed = false;

  constructor(
    private readonly view: ViewLike,
    private readonly options: ComposerCompletionOptions,
  ) {}

  get isOpen(): boolean {
    return !!this.token && this.visible;
  }
  /** The popup owns keys even before it is visible (typing a live token). */
  private get active(): boolean {
    return !!this.token;
  }
  private get rows(): PopupRow[] {
    return flattenRows(this.groups);
  }
  private get selected(): PopupRow | undefined {
    return this.rows.find((row) => row.id === this.selectedId);
  }
  private slashEnabled(): boolean {
    return !!this.options.slashCommand?.();
  }

  // ---- editor updates -----------------------------------------------------

  onUpdate(update: {
    docChanged: boolean;
    selectionSet: boolean;
    state: EditorState;
    changes: ViewUpdate["changes"];
    transactions: ViewUpdate["transactions"];
  }): void {
    if (this.destroyed) return;
    if (update.docChanged && this.dismissedFrom !== undefined)
      this.dismissedFrom = update.changes.mapPos(this.dismissedFrom, -1);
    const typed = update.docChanged && isTyping(update);
    if (!this.active && !typed) return;
    if (!update.docChanged && !update.selectionSet) return;
    this.sync(update.state);
  }

  private sync(state: EditorState): void {
    const token = completionTokenAt(state, this.slashEnabled());
    if (!token) {
      this.dismissedFrom = undefined;
      this.close();
      return;
    }
    if (this.dismissedFrom !== undefined) {
      if (token.from === this.dismissedFrom) return;
      this.dismissedFrom = undefined;
    }
    const opening = !this.token;
    this.token = token;
    if (opening) {
      this.placement = this.choosePlacement();
      this.selectedId = undefined;
      this.results = undefined;
      this.visible = false;
    }
    const key = `${token.kind}:${token.from}:${token.raw}`;
    if (key === this.tokenKey && !opening) {
      this.publish();
      return;
    }
    this.tokenKey = key;
    this.notice = undefined;
    this.noticeItem = undefined;
    if (token.kind === "slash") {
      this.seq++;
      this.loading = false;
      this.visible = true;
      this.selectedId = undefined;
      this.recompute();
    } else {
      this.selectedId = undefined;
      this.scheduleSearch(token, false);
      this.recompute();
    }
  }

  private choosePlacement(): "above" | "below" {
    const dom = this.view.dom;
    if (!dom || typeof window === "undefined") return "above";
    const rect = dom.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    return rect.top >= POPUP_MIN_SPACE || rect.top >= below ? "above" : "below";
  }

  // ---- search -------------------------------------------------------------

  private scheduleSearch(token: CompletionToken, preserve: boolean): void {
    clearTimeout(this.searchTimer);
    this.loading = true;
    const delay = this.options.searchDelayMs ?? SEARCH_DELAY_MS;
    if (!this.visible && !this.showTimer)
      this.showTimer = setTimeout(() => {
        this.showTimer = undefined;
        if (!this.token || this.destroyed) return;
        this.visible = true;
        this.recompute();
      }, SHOW_AFTER_MS);
    const run = () => void this.search(token, preserve);
    if (delay <= 0) run();
    else this.searchTimer = setTimeout(run, delay);
  }

  private async fetchMention(
    token: CompletionToken,
    source: ComposerReferenceSource | undefined,
  ): Promise<ComposerSearchResponse> {
    const limit = token.scope
      ? COMPLETION_SCOPED_RESULT_LIMIT
      : token.query === ""
        ? RECENT_REQUEST_LIMIT
        : COMPLETION_RESULT_LIMIT;
    if (!source) return { items: [], sources: [] };
    return await source.search(token.raw.slice(1), { limit });
  }

  private async search(
    token: CompletionToken,
    preserve: boolean,
  ): Promise<void> {
    const seq = ++this.seq;
    const generation = generationOf(this.options);
    const source = this.options.referenceSource?.();
    this.loading = true;
    try {
      const response = await this.fetchMention(token, source);
      if (this.stale(seq, generation, source)) return;
      this.results = response as ComposerSearchResponse;
      this.loading = false;
      this.visible = true;
      clearTimeout(this.showTimer);
      this.showTimer = undefined;
      if (!preserve) this.selectedId = undefined;
      this.recompute();
    } catch (error) {
      if (this.stale(seq, generation, source)) return;
      this.loading = false;
      this.visible = true;
      this.notice = {
        tone: "destructive",
        icon: "error",
        text: error instanceof Error ? error.message : "Search failed.",
      };
      this.recompute();
    }
  }

  private stale(
    seq: number,
    generation: number,
    source: ComposerReferenceSource | undefined,
  ): boolean {
    return (
      this.destroyed ||
      !this.token ||
      seq !== this.seq ||
      generation !== generationOf(this.options) ||
      source !== this.options.referenceSource?.()
    );
  }

  /** Re-run the current search (source change event), keeping the selection. */
  refresh(): void {
    if (!this.token || this.pending) return;
    if (this.token.kind === "slash") this.recompute();
    else void this.search(this.token, true);
  }

  // ---- model --------------------------------------------------------------

  private recompute(): void {
    const token = this.token;
    if (!token) return;
    const sources = this.results?.sources ?? [];
    const loadingGroups = loadingState(sources);
    if (token.kind === "slash") {
      this.groups = buildSlashGroups(
        this.options.slashCompletions(),
        token.raw,
        this.options.slashContext?.(),
      );
    } else {
      const source = this.options.referenceSource?.();
      this.groups = buildMentionGroups({
        items: this.results?.items ?? [],
        scope: token.scope,
        recent: !token.scope && token.query === "" && !!source,
        totals: this.results?.groups,
        loadingGroups,
      });
      if (this.groups.length === 0 && token.scope && this.loading) {
        const scope = completionScope(token.scope)!;
        this.groups = [
          { id: scope.id, label: scope.label, rows: [], loading: true },
        ];
      }
    }
    const rows = this.rows;
    if (!rows.some((row) => row.id === this.selectedId))
      this.selectedId = firstEligibleRow(this.groups)?.id;
    this.publish();
  }

  private footer(selected: PopupRow | undefined): PopupFooter | undefined {
    const token = this.token!;
    const onAction = this.options.action?.();
    if (this.notice) return this.notice;
    if (selected?.state === "unavailable")
      return {
        tone: "warning",
        icon: "warning",
        text: selected.reason ?? `${selected.name} isn’t available right now.`,
        action: onAction ? { label: "Settings", id: "item" } : undefined,
      };
    if (selected?.state === "off")
      return {
        tone: "info",
        icon: "info",
        text: "Also turns it on for this project",
      };
    const unavailable = unavailableFooter(this.results?.sources ?? []);
    if (unavailable) {
      return {
        ...unavailable.footer,
        action: onAction ? unavailable.footer.action : undefined,
      };
    }
    if (token.kind === "slash")
      return {
        tone: "muted",
        text: "Runs now — nothing is sent to the agent",
      };
    if (this.rows.length === 0 && this.loading)
      return { tone: "muted", icon: "spinner", text: "Searching" };
    return undefined;
  }

  private emptyText(): string | undefined {
    const token = this.token!;
    if (this.rows.length > 0 || this.groups.some((group) => group.loading))
      return undefined;
    if (token.kind === "slash") return `No commands match “${token.raw}”`;
    if (this.loading && !this.results) return undefined;
    return emptyMentionText(token);
  }

  private publish(): void {
    const token = this.token;
    if (!token || !this.visible) {
      this.options.onModel?.(null);
      return;
    }
    const selected = this.selected;
    const scope = token.scope ? completionScope(token.scope) : undefined;
    const model: PopupModel = {
      mode: token.kind,
      placement: this.placement,
      groups: this.groups,
      selectedId: this.selectedId,
      scope: scope ? { id: scope.id, label: scope.label } : undefined,
      query: token.kind === "slash" ? token.raw : token.query,
      showScopeHint:
        token.kind === "mention" && !token.scope && token.query === "",
      footer: this.footer(selected),
      primary:
        token.kind === "slash"
          ? "Run"
          : selected?.state === "off"
            ? "Enable & insert"
            : selected?.state === "unavailable"
              ? "Details"
              : "Insert",
      pendingId: this.pending?.id,
      empty: this.emptyText(),
      toggleLabel: selected?.toggleable
        ? selected.state === "off"
          ? "Turn on"
          : "Turn off"
        : undefined,
    };
    this.options.onModel?.(model);
  }

  // ---- interaction --------------------------------------------------------

  select(id: string): void {
    if (this.selectedId === id || !this.rows.some((row) => row.id === id))
      return;
    this.selectedId = id;
    this.notice = undefined;
    this.publish();
  }

  /** Move toward better (`toward = "best"`) or worse matches, wrapping. */
  move(direction: "up" | "down"): boolean {
    const rows = this.rows;
    if (!this.isOpen || rows.length === 0) return false;
    const index = Math.max(
      0,
      rows.findIndex((row) => row.id === this.selectedId),
    );
    // Above: best match is at the bottom, so "up" walks toward worse matches.
    const toWorse =
      this.placement === "above" ? direction === "up" : direction === "down";
    const next = (index + (toWorse ? 1 : -1) + rows.length) % rows.length;
    this.select(rows[next]!.id);
    return true;
  }

  /** Enter/Tab/click. Returns whether the key was consumed. */
  accept(id?: string): boolean {
    if (!this.isOpen) return false;
    if (id) this.select(id);
    const row = this.selected;
    if (!row) return false;
    if (this.pending) return true;
    if (this.token!.kind === "slash") return this.runSlash(row);
    if (row.state === "unavailable") {
      const onAction = this.options.action?.();
      this.notice = {
        tone: "warning",
        icon: "warning",
        text: row.reason ?? `${row.name} isn’t available right now.`,
        action: onAction ? { label: "Settings", id: "item" } : undefined,
      };
      this.noticeItem = row.item;
      this.publish();
      return true;
    }
    const source = this.options.referenceSource?.();
    if (source && row.item.documentId && row.item.version)
      void this.runSelectAction(row, source, "select", "insert");
    else this.insert(row, this.token!, this.view.state.doc);
    return true;
  }

  /** Alt+Enter / row button: turn the selected skill/tool/agent on or off. */
  toggle(id?: string): boolean {
    if (!this.isOpen) return false;
    if (id) this.select(id);
    const row = this.selected;
    const source = this.options.referenceSource?.();
    if (!row?.toggleable || !source) return !!row;
    if (this.pending) return true;
    void this.runSelectAction(
      row,
      source,
      row.state === "off" ? "select" : "disable",
      "stay",
    );
    return true;
  }

  private async runSelectAction(
    row: PopupRow,
    source: ComposerReferenceSource,
    action: "select" | "disable",
    then: "insert" | "stay",
  ): Promise<void> {
    const token = this.token!;
    const doc = this.view.state.doc;
    const generation = generationOf(this.options);
    this.pending = { id: row.id, source, doc };
    this.notice = undefined;
    this.publish();
    const live = () =>
      !this.destroyed &&
      generation === generationOf(this.options) &&
      this.pending?.doc === doc &&
      this.view.state.doc === doc &&
      source === this.options.referenceSource?.();
    try {
      const selected = await source.select(row.item, action);
      if (!live()) return;
      this.pending = undefined;
      if (then === "stay") {
        // Toggled in place: stay open and show the new state.
        this.selectedId = row.id;
        void this.search(token, true);
        return;
      }
      this.insert(
        { ...row, insert: selected.apply ?? selected.label, item: selected },
        token,
        doc,
      );
    } catch (error) {
      if (!live()) {
        if (this.pending?.doc === doc) this.pending = undefined;
        return;
      }
      this.pending = undefined;
      const message = error instanceof Error ? error.message : "";
      if (isCompletionConflict(error)) {
        this.notice = {
          tone: "warning",
          icon: "warning",
          text: `“${row.name}” changed while you were choosing. Refreshed — press Enter to retry.`,
        };
        this.selectedId = row.id;
        void this.search(token, true);
      } else {
        this.notice = { tone: "destructive", icon: "error", text: message };
        this.publish();
      }
    }
  }

  private insert(
    row: PopupRow,
    token: CompletionToken,
    doc: EditorState["doc"],
  ): void {
    if (this.view.state.doc !== doc) return;
    const insert = row.insert;
    this.dismissedFrom = undefined;
    this.close();
    this.view.dispatch(
      insertMentionsTransaction(
        this.view.state,
        [
          {
            insert,
            label: row.chipLabel,
            kind: row.kind,
            title: row.item.info ?? insert,
          },
        ],
        { from: token.from, to: token.to },
      ),
    );
  }

  private runSlash(row: PopupRow): boolean {
    const run = this.options.slashCommand?.();
    if (!run || !row.command) return false;
    this.close();
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length },
      userEvent: "delete",
    });
    run(row.command);
    return true;
  }

  /** Status-bar action button. */
  runFooterAction(): void {
    const onAction = this.options.action?.();
    if (!onAction) return;
    if (this.noticeItem || this.selected?.state === "unavailable") {
      onAction({ type: "item", item: this.noticeItem ?? this.selected!.item });
      return;
    }
    const unavailable = unavailableFooter(this.results?.sources ?? []);
    if (unavailable?.footer.action)
      onAction({
        type: "source",
        source: unavailable.source,
        actionId: unavailable.footer.action.id as
          | "open_pull_requests"
          | "open_settings",
      });
  }

  /** "+N more": narrow the mention to one category. */
  setScope(scope: CompletionScopeId): void {
    const token = this.token;
    const info = completionScope(scope);
    if (!token || token.kind !== "mention" || token.scope || !info) return;
    this.view.dispatch({
      changes: { from: token.from + 1, insert: info.prefix },
      userEvent: "input.type",
    });
  }

  /** Chip ×, or Backspace on an empty scoped query: search everything. */
  clearScope(): boolean {
    const token = this.token;
    if (!token || token.kind !== "mention" || !token.scope) return false;
    this.view.dispatch({
      changes: {
        from: token.from + 1,
        to: token.from + 1 + token.scopeLength,
      },
      userEvent: "delete.backward",
    });
    return true;
  }

  /** Backspace key: widen only when the scoped query is empty at the caret. */
  backspace(): boolean {
    const token = this.token;
    if (
      !this.isOpen ||
      !token?.scope ||
      token.query !== "" ||
      this.view.state.selection.main.head !== token.to
    )
      return false;
    return this.clearScope();
  }

  /** Esc: hide for this token until it changes. */
  dismiss(): boolean {
    if (!this.token) return false;
    this.dismissedFrom = this.token.from;
    this.close();
    return true;
  }

  close(): void {
    clearTimeout(this.searchTimer);
    clearTimeout(this.showTimer);
    this.showTimer = undefined;
    this.seq++;
    this.token = undefined;
    this.tokenKey = "";
    this.results = undefined;
    this.groups = [];
    this.selectedId = undefined;
    this.notice = undefined;
    this.noticeItem = undefined;
    this.loading = false;
    this.visible = false;
    this.pending = undefined;
    this.options.onModel?.(null);
  }

  destroy(): void {
    this.close();
    this.destroyed = true;
  }
}

const controllers = new WeakMap<EditorView, ComposerCompletionController>();

export const composerCompletionController = (view: EditorView) =>
  controllers.get(view);

/** Close the popup (source/props changed, or the editor is reconfigured). */
export function closeCompletion(view: EditorView): void {
  controllers.get(view)?.close();
}

/** Re-run the open search after the source reported a change. */
export function refreshComposerReferenceCompletions(view: EditorView): void {
  controllers.get(view)?.refresh();
}

export { COMPLETION_SCOPES, sourceLabel };

export function composerCompletionExtensions(
  options: ComposerCompletionOptions,
): Extension {
  if (options.slashCompletions().length === 0 && !options.referenceSource?.()) {
    return [];
  }
  const run =
    (command: (controller: ComposerCompletionController) => boolean) =>
    (view: EditorView): boolean => {
      const controller = controllers.get(view);
      return controller ? command(controller) : false;
    };
  return [
    ViewPlugin.define((view) => {
      const controller = new ComposerCompletionController(view, options);
      controllers.set(view, controller);
      return {
        update: (update) => controller.onUpdate(update),
        destroy: () => {
          controller.destroy();
          if (controllers.get(view) === controller) controllers.delete(view);
        },
      };
    }),
    Prec.highest(
      keymap.of([
        { key: "ArrowUp", run: run((c) => c.move("up")) },
        { key: "ArrowDown", run: run((c) => c.move("down")) },
        { key: "Enter", run: run((c) => c.accept()) },
        { key: "Tab", run: run((c) => c.accept()) },
        { key: "Alt-Enter", run: run((c) => c.toggle()) },
        { key: "Escape", run: run((c) => c.dismiss()) },
        { key: "Backspace", run: run((c) => c.backspace()) },
      ]),
    ),
  ];
}
