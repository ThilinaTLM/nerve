# Title bar stops dragging the window

> **Status:** Follow-up to #540. A likely cause is fixed there, but it was not reproduced. Keep this open until the bug is confirmed fixed or the real cause is found.

## Symptom

After the desktop app has been running for a while, the empty area of the top title bar (between the project tabs and the right-side controls) no longer drags the window.

## What #540 changed

The drop-to-open overlay (`features/projects/views/DropToOpenOverlay.svelte`) is a fixed `no-drag` strip over the title bar, mounted while a file drag is active. Its state could get stuck when `dragleave` was skipped (cancelled drags, drops outside the window, elements removed mid-drag), and its fade-in could leave it invisible but still blocking. #540 adds `file-drag-tracker.ts` (enter/leave depth plus a 1.5 s idle watchdog), resets on window blur, Escape and window-edge `dragleave`, and removes the fade-in.

On a healthy idle instance the gap is `app-region: drag` and nothing covers it.

## If it happens again

In DevTools, run:

```js
document.querySelector('[aria-label="Drop to open as a project"]');
document
  .elementsFromPoint(innerWidth / 2, 20)
  .map((el) => [
    el,
    getComputedStyle(el).getPropertyValue("-webkit-app-region"),
  ]);
```

- **The overlay is present:** the drag state is still getting stuck. Note what preceded it (which drag, where it was dropped) and extend the tracker's reset cases.
- **The overlay is absent and the gap is `drag`:** the app's CSS is correct and Chromium's drag regions are stale. This is a known class of Electron issue on Linux, often after an external drag-and-drop. It would need a workaround in `packages/desktop-shell`, such as forcing a drag-region recompute (toggling a style on the title bar, or a resize nudge) on window focus or after drag end.
- **Something else covers the gap:** fix that element's stacking or `app-region`.
