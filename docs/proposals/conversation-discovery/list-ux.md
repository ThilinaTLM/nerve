# Conversation list UX

## Sections

Each visible root conversation appears in exactly one section, using the first rule that matches:

| Section | Membership | Order |
| --- | --- | --- |
| **Pinned** | Pinned, whatever its status | Most recent user prompt first (current behavior) |
| **Needs you** | Pending question or approval; uncleared failure or interruption; existing `result-ready` activity (green "Finished" marker) | Pending input, then failures/interruptions, then finished; most recent user prompt first within each group |
| **Today / Yesterday / Previous 7 days / Older** | Everything else | Existing day buckets and order (`last_user_message_at` descending) from `project-tree.ts` |

- Pinned comes first and isn't duplicated: a pinned conversation that needs you stays in Pinned, and its status label shows it. There's no pin icon on cards; pin state lives in the context menu.
- Running conversations stay in Pinned or a day section with a "Running" status. They aren't promoted above questions.
- Empty sections are hidden. Section headers show conversation counts (conversations, not messages or child tasks).
- Completed conversations (`completedAt`) stay hidden from the sections (existing hide-completed preference) and are found via search ("done"). A completed conversation with pending input still shows in Needs you.
- Running a conversation never sets `completedAt`. Marking a conversation completed remains a user action.

### Attention state we reuse

There's no new acknowledgement logic. The finished part of Needs you is a grouping of what the client already tracks:

- `application/activity/conversation-attention.ts` emits a `finished` edge on root busy → idle transitions. The edge is recorded in `unseenResults` (session-local, `unseen-results.svelte.ts`) unless the user is watching that conversation.
- `presentation/conversations/conversation-activity.ts` maps it to `indicator: "result-ready"` ("Finished"). Pending input, failure, running, and interruption take precedence.
- The marker clears when the user opens or switches to the conversation (including its ancestors), on window focus/interaction while it's active, or when its notification is dismissed or "clear finished" is used (`WorkbenchTitlebarHost.svelte`).

Section assignment is a pure function over the existing activity (`conversationActivityById`) plus pin and completion state, owned by the presentation layer next to `conversation-row-state.ts`. It doesn't introduce a second status predicate. Opening a Finished card acknowledges it (current behavior), so it moves to its day section while keeping its selection and scroll anchor.

## Row anatomy

Each conversation is a **card** (`ItemSurface` with `tone="card"`, `hover="soft"`) on the unchanged panel surface (`PanelView`, `bg-card`), so the dock shell and other tabs stay as they are. Cards stack with a small gap. Two lines:

1. **Title:** full card width, normal weight (not bold; selection adds `font-medium` as today), at most two lines, line-clamped. An inline image marker renders as a small `Image` icon with the accessible name "Image" (see [title-generation.md](title-generation.md#image-marker)).
2. **Meta line:** status, references, and time on one line:
   - **Status** (only when there is one): the existing `ConversationActivityIndicator` icon plus a short label in the status tone: `Question`, `Approval`, `Plan` (plan review), `Failed`, `Stopped`, `Finished`, `Running`. Waiting on sub-agents or background commands (`awaiting-async`) is also labelled `Running` but keeps its `ClockAlert` icon instead of the pulsing dot. These replace the longer `statusText` strings in the list. The full text ("Question for you", "Agent failed", …) stays in the accessible name and tooltip.
   - **References:** up to two tags plus `+N`.
   - **Time:** right-aligned relative time of the last user prompt. The exact time is in the tooltip. There are no hover actions; everything else lives in the context menu.

There are no leading glyph column, pin icon, planning-profile icon, sub-agent count, previews, or model/cost fields; profile and sub-agent count move to the tooltip. The idle open-tab dot is dropped; the tab strip already shows open conversations.

### Reference tags

- Quiet, non-interactive `text-muted-foreground` tags: a typed icon (`GitPullRequest` for PRs, `CircleDot` for issues) plus `#481`. The whole card opens the conversation; GitHub is opened from the context menu.
- Foreign repositories show a **short repository label** plus the number, e.g. `inshsc-registry#1203` for `acme-platform-engineering/internal-shared-schema-registry`. The label uses the Git panel's `repositoryLabels` algorithm (`features/git/views/repository-labels.ts`) over the repository names referenced in the project, with a 16-character budget:
  - the owner is dropped;
  - long words are abbreviated, and role words like `api` or `web` are kept;
  - the owner is added back only to tell apart same-named repos (`acme-api#481` vs `contoso-api#77`).

  Move that module to a shared location (for example `presentation/`) instead of importing it across features. The full `owner/repo#n` is in the tooltip and the accessible name.
- Created vs referenced is shown by the icon alone, with no text prefix: created PRs use `GitPullRequestCreateArrow` and created issues use `CirclePlus`. The tooltip and accessible name say "Created pull request …" / "Referenced pull request …".
- When both kinds exist, one visible slot goes to created and one to referenced. Within a kind, tags keep their first-seen order. `+N` is plain text, and its tooltip lists every reference.

### Context menu

Right-click (and long-press) opens the existing conversation menu (`buildConversationMenu`): Open, New chat, Pin/Unpin, Mark done/Reopen, Clear status (failures only), **Open on GitHub ▸** (new, when references exist; one item per reference with its full description), Copy ID, Delete.

### Implementation notes

- Extend `PanelRow`/`ProjectAgentTreeNode` rather than forking markup: segmented title, and a `meta` snippet that replaces `detail` + `trailing`.
- Fix in `ItemSurface`: with `tone="card"` in dark mode, `dark:bg-accent/35` outranks `bg-selected`, so the selected card isn't highlighted. Selection must also override the `dark:` card background.

## Ordering and stability

- Order and relative time use `last_user_message_at`, the time of the last actual user prompt. The client already does this (`project-tree.ts`); keep it. Assistant output, tool results, system events, and metadata changes don't move a row. Conversations without a prompt yet fall back to `created_at`. See [storage.md](storage.md#recency).
- Title replacement (manual or AI) and reference extraction don't change order, section, selection, focus, or unseen state. Titles update in place with no "generating" spinner.
- While the user is interacting (menu open, keyboard browsing), keep the selected row and scroll anchor when section membership changes. Never reorder rows on token streams.

## Smart search

The header keeps settings and new chat; the search icon, the inline filter select, and the "N need you" button go away. The Needs you section replaces the latter.

A **`SearchInput`** sits directly under the header, above the first section, and is always visible. The existing search shortcut (`searchFocusToken`) focuses it, which replaces `ProjectConversationsDialog`. Escape clears it.

**One input, no syntax.** Each whitespace-separated term must match at least one of the following, and the best-scoring field counts:

| Field | Matches | Example terms |
| --- | --- | --- |
| Reference | Exact number, `owner/repo#n`, or a GitHub URL; kind words | `481`, `#481`, `acme/api#481`, `https://github.com/acme/web/pull/492`, `pr`, `issue`, `created` |
| Status | Prefix of a status word | `question`, `approval`, `fail`/`error`, `stopped`, `fin`/`ready`/`review`, `running`, `done`, `pinned`, `needs`/`attention` |
| Image | Titles that contain the image marker | `image`, `screenshot` |
| Title | Substring (word starts score higher), then **lazy** in-order subsequence that prefers consecutive letters and word starts | `dash`, `wsback` → "**w**eb**s**ocket … **back**off" |

- **Ranking:**
  1. Sum of term scores: exact reference (created first) > status word > title word start > title substring > lazy match.
  2. Ties: `last_user_message_at` descending.
  3. Lazy matches whose letters are scattered are dropped. So are hits scoring below a fraction of the best hit, which keeps lazy noise out next to exact matches.
- **Results:** a single ranked "Results" section of the same cards. Matched title letters get a subtle `bg-primary/25` mark. A matched reference tag is moved into the first visible slot and highlighted. Status matches are already visible as the status label. Search matches the full repository name as well as the short label.
- **Scope:** every root conversation in the project, including done ones (shown with a "Done" status). It runs client-side over the loaded summaries: `conversation.list` has no limit, so the 100-row cap is display-only and doesn't apply to search. Typing "done" is how completed conversations are found, replacing the hide-completed toggle for retrieval.
- **Implementation:** the matcher is a pure function in the presentation layer (next to section assignment) with unit tests. It uses each summary's title, activity, pin/completion state, and `references`.
- **Empty states:** the empty project, everything done ("Search “done” to find them"), and no matches (suggest a status, PR number, or part of a title) each get their own message.

## Actions

All row actions live in the context menu (see above); there are no inline or hover actions. Touch users open it with a long press. Notification dismiss and "clear finished" remain the ways to acknowledge without navigating. There's no archive action.

## Accessibility

- Use a semantic list. Each card is one interactive target (opens the conversation) with a context menu; reference tags are plain text, so nothing interactive is nested.
- Every status has a text label. Focus stays visible.
- The full title and all references are in the accessible name or details even when they're visually truncated.
- Use shadcn-svelte components, `@lucide/svelte` icons, and theme tokens. Don't add control sizes or per-row height patches.

## Code touchpoints

- `features/projects/views/ProjectConversationNavigator.svelte`: panel, display limit
- `features/projects/views/ProjectConversationsDialog.svelte`: replaced by the inline smart search
- `presentation/items/ItemSurface.svelte`: card selection fix
- `domain/projects/project-tree.ts`: grouping, to be replaced by section assignment
- `features/projects/adapters/conversation-sidebar.adapter.ts`: summary mapping, references, search dispatch
- `presentation/conversations/conversation-row-state.ts`, `conversation-activity.ts`, `ConversationActivityIndicator.svelte`: row state and status

## Tests

- Section assignment: each conversation appears exactly once; precedence order; pinned rows aren't duplicated; running rows aren't promoted; completed rows with pending input stay visible.
- Recent order uses `last_user_message_at` with a `created_at` fallback. Title/reference/status updates don't reorder rows.
- Acknowledging a Ready row moves it without losing the selection.
- Existing unseen behavior doesn't change: watching suppresses the marker, open/focus/dismiss clear it, ancestors are handled, and baseline loads are quiet. Metadata-only updates create no `finished` edge.
- Reference slot allocation (one created and one referenced slot, `+N`, matched reference first) and short status labels.
- Smart search: each term must match; status prefixes; reference forms; title substring and lazy subsequence with word-start preference; scattered lazy matches dropped; ranking and relative cut-off; done conversations included.
