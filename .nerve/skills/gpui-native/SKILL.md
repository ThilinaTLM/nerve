---
name: gpui-native
description: Inspect, screenshot, resize, and safely control the native Nerve GPUI Workbench on KDE Wayland. Use when testing GPUI UI behavior, reviewing native rendering, clicking a GPUI control, checking responsive desktop/mobile layouts, or gathering visual feedback from the GPUI desktop client. This is for the native GPUI app, not Electron or browser pages.
allowed-tools: Bash(python3 .nerve/skills/gpui-native/scripts/native_gui.py:*), Bash(target/debug/nerve-gpui-workbench:*), Bash(pnpm gpui:*)
---

# GPUI native testing on KDE Wayland

The GPUI Workbench has no DOM, CDP endpoint, Agent Browser refs, or usable Linux accessibility tree. Test it with two complementary layers:

- GPUI `TestAppContext` tests are authoritative for deterministic state and callbacks.
- This skill drives the real KDE Wayland window and captures real rendered pixels for agent review.

The bundled helper targets exactly one window with class `nerve-gpui-workbench`. It never launches or closes an app or server.

## Safety rules

1. **Never test against the live Nerve home.** Use a fresh or copied `NERVE_HOME` under `/tmp` and an explicit test port/target.
2. **Never start, stop, restart, or mutate a Workbench server.** Connect only to an existing isolated server when server-backed content is needed.
3. Inspect active tasks before starting a client. Stop only the exact client task/PID you launched.
4. Never run raw `ydotool mousemove --absolute`. It is unsafe on the current multi-monitor Wayland layout and can target another application.
5. Never run generic `kdotool getactivewindow windowclose`. Focus can change while the pointer moves.
6. Use only the bundled helper for pointer input. It verifies one exact class/UUID, geometry, focus, pointer bounds, and post-action focus.
7. Never type credentials. Avoid screenshots when another application containing secrets could be exposed.
8. Screenshot coordinates become stale after any resize, move, popup, or layout change. Capture again before the next click.

## Helper

From the repository root:

```bash
GUI='python3 .nerve/skills/gpui-native/scripts/native_gui.py'
$GUI preflight
```

The helper prints compact JSON on success and an actionable JSON error with nonzero exit on failure.

### Available commands

```bash
$GUI info
$GUI activate
$GUI capture --output /tmp/nerve-gpui-shot.png
$GUI move --x 120 --y 95
$GUI click --x 120 --y 95
$GUI key --name escape
$GUI resize --width 1280 --height 800
```

Coordinates are relative to the top-left of the latest screenshot. Captures retain window decorations but remove shadows, so PNG dimensions exactly match KWin geometry and coordinate mapping stays one-to-one.

Supported keys are `escape`, `enter`, `tab`, `space`, `left`, `right`, `up`, and `down`. Arbitrary text typing is intentionally unsupported.

If more than one GPUI Workbench window exists, `info` fails closed and lists the count. Resolve the intended exact UUID first, then add `--window '{uuid}'` to every command. Do not guess.

## Core feedback loop

This is the native equivalent of Agent Browser's snapshot/interact/resnapshot loop:

1. Start the isolated GPUI client.
2. Inspect the exact window.
3. Capture a PNG.
4. Read the PNG with the image file tool.
5. Select a coordinate from that latest PNG.
6. Click using the helper.
7. Capture and read again before another action.

Example:

```bash
GUI='python3 .nerve/skills/gpui-native/scripts/native_gui.py'
RUN_DIR=/tmp/nerve-gpui-visual/$(date +%s)
mkdir -p "$RUN_DIR"

$GUI info
$GUI capture --output "$RUN_DIR/01-initial.png"
# Read 01-initial.png with the image tool, then choose a point.
$GUI click --x 56 --y 82
$GUI capture --output "$RUN_DIR/02-after-click.png"
```

Do not chain several coordinate clicks from one screenshot. Popovers, selection changes, and responsive transitions alter hit targets.

## Launching the client safely

First inspect active tasks. Prefer a durable task for the client so its exact lifecycle remains visible. Use a fresh home and explicit target:

```bash
rm -rf /tmp/nerve-gpui-test-home
mkdir -p /tmp/nerve-gpui-test-home
NERVE_HOME=/tmp/nerve-gpui-test-home \
NERVE_API_TARGET=http://127.0.0.1:4757 \
pnpm gpui
```

Port `4757` is only an example. The helper does not require a server for loading/error/empty visual states. For project-switcher and conversation data, the target must already be served by an isolated existing Workbench server with a matching token in the temporary home.

The GPUI client reads `<NERVE_HOME>/secrets/daemon-token`; never print that file or place its value in command arguments/logs.

## Capturing and reviewing

Capture only after `info` confirms the target:

```bash
$GUI capture --output /tmp/nerve-gpui-visual/desktop.png
```

Read the emitted path with the image file tool. Review at minimum:

- project trigger label, width, clipping, and dropdown placement;
- conversation section hierarchy, counts, selected state, dates, and truncation;
- connection/loading/error/empty states;
- panel borders, scrolling, spacing, and status bar;
- desktop and narrow/mobile compositions.

For a narrow layout:

```bash
$GUI resize --width 760 --height 820
$GUI capture --output /tmp/nerve-gpui-visual/narrow.png
```

After resizing, discard all old coordinates.

## Input details

`click` first activates the exact KWin UUID, checks bounds, and converts screenshot-relative coordinates to global logical coordinates. It moves with bounded, feedback-controlled relative steps because absolute ydotool coordinates are incorrect on this multi-monitor setup. It then reactivates and reverifies the exact target immediately before and after the click.

A failed move or focus verification is a hard stop. Capture again; do not bypass the guard with raw desktop commands.

Use keys mainly for dismissing menus and checking keyboard behavior:

```bash
$GUI key --name escape
$GUI capture --output /tmp/nerve-gpui-visual/after-escape.png
```

## Cleanup

Stop only the exact client task/PID created for the test. The helper intentionally has no `close` command. Then verify the test client is gone without touching the normal Nerve desktop app or any server:

```bash
pgrep -af 'target/debug/nerve-gpui-workbench' || true
```

Keep artifacts under `/tmp`; do not add screenshots to the repository unless explicitly requested.

## Limits

- This workflow currently supports KDE Plasma on Wayland only.
- It is agent-assisted visual smoke testing, not stable pixel-diff CI.
- Xvfb is not a fallback: GPUI's Vulkan presentation requires DRI3 and failed on plain Xvfb in this environment.
- Coordinate control is less semantic than Agent Browser. GPUI `debug_selector` interaction tests should cover important behavior independently.
- Connected visual fixtures and macOS support are future work.
