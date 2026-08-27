/* Simulated agent runs.
 *
 * Two marketing surfaces play a scripted Nerve run as live DOM instead of a
 * screenshot: the hero transcript and the hot-swap lab. Both are driven from
 * here so they stay one mechanism, and the rows are styled after the real
 * workbench transcript: tool cards with a status icon, bold tool name, mono
 * arguments, an inset output box and a line-count footer; italic thinking
 * text; plain prose replies.
 *
 * Rules:
 *
 *   1. No GSAP. Rows enter through a CSS animation that the reduced-motion
 *      block in `motion.css` collapses to an instant appearance, so this module
 *      works on the critical path without the stage runtime.
 *   2. The authored markup already contains a complete static transcript. The
 *      sim only starts when scripting is available; under
 *      `prefers-reduced-motion` nothing autoplays, and the lab responds to a
 *      control change by rendering the whole adjusted turn at once.
 *   3. The lab demonstrates only documented semantics: a configuration change
 *      never recreates the conversation and applies from the next provider
 *      request, not the one already streaming.
 */

export interface ToolCall {
  name: string;
  args: string;
  out: string[];
  lines: string;
}

export interface SimRow {
  kind: "prompt" | "thinking" | "prose" | "tool" | "gate" | "note";
  text?: string;
  tool?: ToolCall;
  /* `note` rows: "config" is the control plane, "policy" is an enforcement. */
  noteTone?: "config" | "policy";
  noteStatus?: string;
  /* Milliseconds after the previous row. */
  wait: number;
  /* Tool rows: milliseconds spent in the running state. */
  runFor?: number;
}

export interface SimConfig {
  model: "fable" | "opus" | "gpt" | "kimi";
  thinking: "off" | "low" | "medium" | "high";
  mode: "coding" | "planning";
  permission: "read_only" | "supervised" | "autonomous";
}

export interface RunSimHandle {
  setConfig(partial: Partial<SimConfig>): void;
  destroy(): void;
}

const MODEL_LABEL: Record<SimConfig["model"], string> = {
  fable: "Fable",
  opus: "Opus",
  gpt: "GPT",
  kimi: "Kimi",
};

const PERMISSION_LABEL: Record<SimConfig["permission"], string> = {
  read_only: "read-only",
  supervised: "supervised",
  autonomous: "autonomous",
};

const CONFIG_LABEL: Record<keyof SimConfig, string> = {
  model: "model",
  thinking: "thinking",
  mode: "mode",
  permission: "permission",
};

export interface Task {
  prompt: string;
  thinkingHigh: string;
  thinkingLow: string;
  read: ToolCall;
  verify: ToolCall;
  edit: ToolCall;
  plan: ToolCall;
  research: ToolCall;
  reply: string;
  planReply: string;
  findings: string;
}

/* Three rotating tasks so a visitor who watches two loops sees variety. All
 * file names and numbers stay consistent with the claims made elsewhere on the
 * page. */
export const TASKS: Task[] = [
  {
    prompt: "Add a retry budget to the run recovery path.",
    thinkingHigh:
      "Recovery lives in run-recovery.ts. A budget needs the retry count and the base delay in one place, so both call sites read one constant.",
    thinkingLow: "Locating the recovery entry point.",
    read: {
      name: "read",
      args: "examples/retry-service.ts",
      out: ["Read 214 lines"],
      lines: "214 lines",
    },
    verify: {
      name: "bash",
      args: "demo test retry-service",
      out: ["✓ recovery continues from checkpoint (12 tests)", "Done in 3.2s"],
      lines: "6 lines",
    },
    edit: {
      name: "edit",
      args: "examples/retry-service.ts",
      out: ["+12 −3 · retry budget wired into the recovery loop"],
      lines: "2 hunks",
    },
    plan: {
      name: "write",
      args: "plans/example-retry-budget.md",
      out: ["+46 lines · plan storage"],
      lines: "46 lines",
    },
    research: {
      name: "grep",
      args: '"maxAttempts" examples',
      out: ["4 matches in 2 files"],
      lines: "4 matches",
    },
    reply: "Retry budget added: three attempts on a 2s exponential base.",
    planReply: "Plan drafted. Implementation waits for your acceptance.",
    findings:
      "Read-only: retries are hardcoded in two call sites — reported both, changed nothing.",
  },
  {
    prompt: "The policy test is flaky — pin it down.",
    thinkingHigh:
      "The failure is time-dependent. Freezing the clock before the assertion should make it deterministic.",
    thinkingLow: "Reproducing the flaky assertion.",
    read: {
      name: "read",
      args: "examples/policy-window.test.ts",
      out: ["Read 168 lines"],
      lines: "168 lines",
    },
    verify: {
      name: "bash",
      args: "demo test policy-window --repeat 20",
      out: [
        "19 passed · 1 failed on attempt 14",
        "assertion raced a debounce timer",
      ],
      lines: "9 lines",
    },
    edit: {
      name: "edit",
      args: "examples/policy-window.test.ts",
      out: ["+4 −4 · clock frozen before the assertion"],
      lines: "1 hunk",
    },
    plan: {
      name: "write",
      args: "plans/example-policy-test.md",
      out: ["+31 lines · plan storage"],
      lines: "31 lines",
    },
    research: {
      name: "grep",
      args: '"useFakeTimers" examples',
      out: ["11 matches in 7 files"],
      lines: "11 matches",
    },
    reply: "Deflaked: the clock is frozen before the assertion now.",
    planReply: "Plan drafted. Implementation waits for your acceptance.",
    findings:
      "Read-only: the assertion races a debounce timer — two possible fixes reported.",
  },
  {
    prompt: "Surface the compaction profile in the usage panel.",
    thinkingHigh:
      "The usage panel already receives the context fraction. The profile name can ride the same event.",
    thinkingLow: "Finding where usage events are shaped.",
    read: {
      name: "read",
      args: "examples/usage-panel.svelte",
      out: ["Read 96 lines"],
      lines: "96 lines",
    },
    verify: {
      name: "bash",
      args: "demo check usage-panel",
      out: ["Result (312 files):", "- 0 errors, 0 warnings"],
      lines: "5 lines",
    },
    edit: {
      name: "edit",
      args: "examples/usage-panel.svelte",
      out: ["+9 −1 · profile chip beside the context fraction"],
      lines: "1 hunk",
    },
    plan: {
      name: "write",
      args: "plans/example-usage-profile.md",
      out: ["+28 lines · plan storage"],
      lines: "28 lines",
    },
    research: {
      name: "grep",
      args: '"contextFraction" examples',
      out: ["6 matches in 3 files"],
      lines: "6 matches",
    },
    reply: "The usage panel now shows the active compaction profile.",
    planReply: "Plan drafted. Implementation waits for your acceptance.",
    findings:
      "Read-only: profile state is server-side only — exposing it needs one event.",
  },
];

/* One agent turn under a given configuration. This is the product argument in
 * data form: the same task takes a different, visibly-governed path depending
 * on mode and permission. */
export function buildTurn(task: Task, config: SimConfig): SimRow[] {
  const rows: SimRow[] = [];

  rows.push({ kind: "prompt", text: task.prompt, wait: 500 });

  /* Thinking depth changes what the stream shows: off omits the row — the
   * provider returned none — and the higher levels return longer reasoning. */
  if (config.thinking === "low") {
    rows.push({ kind: "thinking", text: task.thinkingLow, wait: 550 });
  } else if (config.thinking === "medium" || config.thinking === "high") {
    rows.push({
      kind: "thinking",
      text: task.thinkingHigh,
      wait: config.thinking === "high" ? 1050 : 850,
    });
  }

  rows.push({ kind: "tool", tool: task.read, wait: 850, runFor: 700 });

  if (config.mode === "planning") {
    rows.push({ kind: "tool", tool: task.research, wait: 1000, runFor: 650 });
    rows.push({ kind: "tool", tool: task.plan, wait: 1000, runFor: 750 });
    rows.push({ kind: "prose", text: task.planReply, wait: 1100 });
    return rows;
  }

  if (config.permission === "read_only") {
    rows.push({ kind: "tool", tool: task.research, wait: 1000, runFor: 650 });
    rows.push({
      kind: "note",
      noteTone: "policy",
      text: "edit blocked at read-only",
      noteStatus: "policy",
      wait: 900,
    });
    rows.push({ kind: "prose", text: task.findings, wait: 1000 });
    return rows;
  }

  if (config.permission === "supervised") {
    rows.push({ kind: "gate", text: "edit needs review", wait: 900 });
  }

  rows.push({ kind: "tool", tool: task.edit, wait: 900, runFor: 800 });
  rows.push({ kind: "tool", tool: task.verify, wait: 1000, runFor: 1000 });
  rows.push({ kind: "prose", text: task.reply, wait: 1100 });

  return rows;
}

/* DOM ----------------------------------------------------------------------- */

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"></circle><path d="m8.5 12.5 2.5 2.5 4.5-5"></path></svg>';

function toolItem(tool: ToolCall, state: "running" | "done"): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "run-item run-tool";
  item.dataset.state = state;
  item.dataset.tool = tool.name;

  item.innerHTML = `
    <div class="run-tool-head">
      <span class="run-tool-status">${CHECK_ICON}</span>
      <b class="run-tool-name"></b>
      <code class="run-tool-args"></code>
    </div>
    <div class="run-tool-out"><pre></pre></div>
    <div class="run-tool-foot">
      <span class="run-tool-lines"></span>
      <span class="run-tool-more">View details</span>
    </div>`;

  const name = item.querySelector(".run-tool-name");
  if (name) name.textContent = tool.name;
  const args = item.querySelector(".run-tool-args");
  if (args) args.textContent = tool.args;
  const out = item.querySelector("pre");
  if (out) out.textContent = tool.out.join("\n");
  const lines = item.querySelector(".run-tool-lines");
  if (lines) lines.textContent = tool.lines;
  return item;
}

function textItem(row: SimRow): HTMLLIElement {
  const item = document.createElement("li");

  if (row.kind === "prompt") {
    item.className = "run-item run-prompt";
    item.innerHTML = `<span class="run-prompt-label">You</span><p></p>`;
    const p = item.querySelector("p");
    if (p) p.textContent = row.text ?? "";
    return item;
  }

  if (row.kind === "thinking") {
    item.className = "run-item run-thinking";
    const p = document.createElement("p");
    p.textContent = row.text ?? "";
    item.append(p);
    return item;
  }

  if (row.kind === "gate") {
    item.className = "run-item run-gate";
    item.dataset.gateState = "waiting";
    item.innerHTML = `
      <span class="run-gate-dot" aria-hidden="true"></span>
      <b>approval</b>
      <span class="run-gate-text"></span>
      <span class="run-gate-status">waiting · for you</span>`;
    const text = item.querySelector(".run-gate-text");
    if (text) text.textContent = row.text ?? "";
    return item;
  }

  if (row.kind === "note") {
    item.className = "run-item run-note";
    item.dataset.tone = row.noteTone ?? "config";
    item.innerHTML = `<code></code><span class="run-note-status"></span>`;
    const code = item.querySelector("code");
    if (code) code.textContent = row.text ?? "";
    const status = item.querySelector(".run-note-status");
    if (status) status.textContent = row.noteStatus ?? "";
    return item;
  }

  item.className = "run-item run-prose";
  const p = document.createElement("p");
  p.textContent = row.text ?? "";
  item.append(p);
  return item;
}

function renderRow(row: SimRow, state: "running" | "done"): HTMLLIElement {
  return row.kind === "tool" && row.tool
    ? toolItem(row.tool, state)
    : textItem(row);
}

/* The gate pauses the stream until it is approved: by the visitor if they take
 * the button, by a timer if they do not. Supervised mode as a behaviour. */
function armGate(item: HTMLLIElement, onResolve: () => void): void {
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "run-approve";
  approve.textContent = "Approve";
  approve.setAttribute("aria-label", "Approve the simulated edit");
  const liveStatus = item
    .closest<HTMLElement>("[data-run-sim]")
    ?.querySelector<HTMLElement>("[data-run-status]");
  if (liveStatus)
    liveStatus.textContent = "Simulated edit is waiting for approval.";

  let timer = 0;
  const resolve = (): void => {
    window.clearTimeout(timer);
    item.dataset.gateState = "approved";
    const status = item.querySelector(".run-gate-status");
    if (status) status.textContent = "approved";
    if (liveStatus) liveStatus.textContent = "Simulated edit approved.";
    approve.remove();
    onResolve();
  };

  approve.addEventListener("click", resolve, { once: true });
  item.append(approve);
  timer = window.setTimeout(resolve, 2800);
}

interface PanelRefs {
  feed: HTMLOListElement;
  chips: {
    model: HTMLElement | null;
    mode: HTMLElement | null;
    permission: HTMLElement | null;
  };
}

function findRefs(root: HTMLElement): PanelRefs | null {
  const feed = root.querySelector<HTMLOListElement>("[data-run-feed]");
  if (!feed) return null;
  return {
    feed,
    chips: {
      model: root.querySelector<HTMLElement>("[data-run-model]"),
      mode: root.querySelector<HTMLElement>("[data-run-mode]"),
      permission: root.querySelector<HTMLElement>("[data-run-permission]"),
    },
  };
}

function syncChips(refs: PanelRefs, config: SimConfig): void {
  if (refs.chips.model) {
    refs.chips.model.textContent = `${MODEL_LABEL[config.model]} · ${config.thinking}`;
  }
  if (refs.chips.mode) {
    refs.chips.mode.textContent =
      config.mode === "planning" ? "Plan" : "Coding";
    refs.chips.mode.dataset.value = config.mode;
  }
  if (refs.chips.permission) {
    refs.chips.permission.textContent = PERMISSION_LABEL[config.permission];
    refs.chips.permission.dataset.value = config.permission;
  }
}

const MAX_ROWS = 10;

function trim(feed: HTMLOListElement): void {
  while (feed.children.length > MAX_ROWS) feed.firstElementChild?.remove();
}

/* Engine --------------------------------------------------------------------- */

export function startRunSim(
  root: HTMLElement,
  options: {
    initial?: Partial<SimConfig>;
    /* Loop mode clears the feed between turns; the lab keeps scrolling. */
    loop?: boolean;
  } = {},
): RunSimHandle | null {
  const refs = findRefs(root);
  if (!refs) return null;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let config: SimConfig = {
    model: "opus",
    thinking: "high",
    mode: "coding",
    permission: "supervised",
    ...options.initial,
  };
  /* A change never interrupts the streaming turn; it lands here and takes
   * effect at the next turn boundary — the next provider request. */
  let pending: SimConfig | null = null;

  let queue: SimRow[] = [];
  let taskIndex = 0;
  let timer = 0;
  let waitingGate = false;
  let onScreen = false;
  let destroyed = false;

  syncChips(refs, config);

  const clearFeed = (): void => {
    refs.feed.replaceChildren();
  };

  /* Reduced motion: never autoplay. The lab still answers a control change by
   * replacing the transcript with the whole adjusted turn at once. */
  if (reduced) {
    return {
      setConfig(partial) {
        config = { ...config, ...partial };
        syncChips(refs, config);
        clearFeed();
        const marker = markerRow(partial);
        if (marker) refs.feed.append(renderRow(marker, "done"));
        for (const row of buildTurn(
          TASKS[taskIndex % TASKS.length] as Task,
          config,
        )) {
          const item = renderRow(row, "done");
          if (row.kind === "gate") {
            item.dataset.gateState = "approved";
            const status = item.querySelector(".run-gate-status");
            if (status) status.textContent = "approved";
          }
          refs.feed.append(item);
        }
        taskIndex += 1;
      },
      destroy() {
        /* Nothing scheduled. */
      },
    };
  }

  const schedule = (wait: number): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(step, wait);
  };

  const beginTurn = (wait: number): void => {
    if (pending) {
      config = pending;
      pending = null;
      syncChips(refs, config);
    }
    const task = TASKS[taskIndex % TASKS.length] as Task;
    taskIndex += 1;
    queue = buildTurn(task, config);

    if (options.loop) {
      /* Let the finished turn linger before it fades, and bring the next
       * prompt in shortly after the wipe so the panel never sits empty. */
      window.setTimeout(() => {
        if (destroyed) return;
        refs.feed.dataset.resetting = "true";
        window.setTimeout(() => {
          clearFeed();
          delete refs.feed.dataset.resetting;
        }, 450);
      }, wait - 900);
      schedule(wait);
      return;
    }
    schedule(wait);
  };

  const step = (): void => {
    if (destroyed || !onScreen || document.hidden || waitingGate) return;

    const row = queue.shift();
    if (!row) {
      beginTurn(options.loop ? 3600 : 2600);
      return;
    }

    const item = renderRow(row, "running");
    refs.feed.append(item);
    trim(refs.feed);

    if (row.kind === "gate") {
      waitingGate = true;
      armGate(item, () => {
        waitingGate = false;
        schedule(500);
      });
      return;
    }

    /* Tool calls run before they resolve: the output box and line count only
     * appear when the running state completes, like the real transcript. */
    if (row.kind === "tool") {
      const runFor = row.runFor ?? 700;
      window.setTimeout(() => {
        if (!destroyed) item.dataset.state = "done";
      }, runFor);
      const next = queue[0];
      schedule(runFor + (next ? next.wait : 2600));
      return;
    }

    const next = queue[0];
    schedule(next ? next.wait : 2600);
  };

  /* First turn starts with the feed the markup shipped; replace it once the
   * sim takes over so there is no double transcript. */
  const start = (): void => {
    clearFeed();
    queue = [];
    schedule(400);
  };

  const observer = new IntersectionObserver(([entry]) => {
    const visible = Boolean(entry?.isIntersecting);
    if (visible === onScreen) return;
    onScreen = visible;
    if (onScreen) {
      if (!refs.feed.dataset.live) {
        refs.feed.dataset.live = "true";
        start();
      } else if (!waitingGate) {
        schedule(600);
      }
    } else {
      window.clearTimeout(timer);
    }
  });
  observer.observe(root);

  const onVisibility = (): void => {
    if (document.hidden) window.clearTimeout(timer);
    else if (onScreen && !waitingGate) schedule(600);
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    setConfig(partial) {
      pending = { ...(pending ?? config), ...partial };
      const marker = markerRow(partial);
      if (marker && refs.feed.dataset.live) {
        refs.feed.append(renderRow(marker, "done"));
        trim(refs.feed);
      }
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/* The control-plane row: what a mid-run change looks like in the stream. */
function markerRow(partial: Partial<SimConfig>): SimRow | null {
  const [key] = Object.keys(partial) as (keyof SimConfig)[];
  if (!key) return null;

  const value = partial[key];
  const display =
    key === "model"
      ? MODEL_LABEL[value as SimConfig["model"]]
      : key === "permission"
        ? PERMISSION_LABEL[value as SimConfig["permission"]]
        : key === "mode"
          ? value === "planning"
            ? "Plan"
            : "Coding"
          : String(value);

  return {
    kind: "note",
    noteTone: "config",
    text: `${CONFIG_LABEL[key]} → ${display}`,
    noteStatus: "applies from the next call",
    wait: 0,
  };
}
