import { escapeHtml } from "./html.js";

/* The block between the `startup-splash` markers is the canonical splash
 * composition. `packages/workbench-app/index.html` mirrors it verbatim so the
 * Electron shell page and the workbench bootstrap render identical pixels, and
 * `scripts/checks/test/startup-splash-sync.test.ts` fails the build on any drift.
 *
 * Rules for editing: only `--splash-*` custom properties may be referenced from
 * the host (each host document declares them; local helpers use other names),
 * every intro delay is offset by `--splash-t0` so the workbench can resume the
 * shell's timeline mid-flight, and the base declarations must describe the
 * *settled* composition so that reduced motion and a finished timeline both
 * land on the finished frame.
 *
 * Choreography: the N is cut into six horizontal bands that slide in from
 * alternating sides, then the plate pops in behind them with a squash and a
 * shockwave while the mark inks to the plate colour. Long waits loop a plate
 * beat and a brief band glitch. `.is-dismissed` plays the exit: copy and plate
 * drop out, the bands slide back out and the backdrop clears, all within
 * `DISMISS_DURATION_MS` in the workbench's startup-splash.ts. */

export const STARTUP_SPLASH_STYLES = `
/* startup-splash:begin */
#startup-splash,
#startup-splash *,
#startup-splash *::before {
box-sizing: border-box;
}
#startup-splash {
position: fixed;
inset: 0;
z-index: 50;
display: grid;
place-items: center;
background: var(--splash-bg);
color: var(--splash-fg);
font-family: var(--splash-font-sans);
/* Frameless desktop window: the backdrop moves it while no titlebar
exists; ignored outside Electron. */
-webkit-app-region: drag;
}
/* Hidden while a startup failure is shown; a retry shows it again. */
#startup-splash.is-hidden {
display: none;
}
#startup-splash.is-dismissed {
pointer-events: none;
/* Drag regions ignore pointer-events; release the window during the
exit so the revealed workbench is clickable at once. */
-webkit-app-region: no-drag;
animation: splash-backdrop-out 300ms ease-in 240ms both;
}
#startup-splash [hidden] {
display: none;
}
#startup-splash-grid {
position: absolute;
inset: 0;
background-image:
linear-gradient(var(--splash-border) 1px, transparent 1px),
linear-gradient(90deg, var(--splash-border) 1px, transparent 1px);
background-position: center;
background-size: 1.5rem 1.5rem;
-webkit-mask-image: radial-gradient(
circle at center,
black,
transparent 60%
);
mask-image: radial-gradient(circle at center, black, transparent 60%);
opacity: 0.55;
animation: splash-fade 700ms ease-out both;
animation-delay: var(--splash-t0, 0ms);
}
#startup-splash-content {
position: relative;
-webkit-app-region: no-drag;
transform: scale(var(--nerve-inverse-zoom-scale, 1));
transform-origin: center;
}
#startup-splash-stage {
display: grid;
justify-items: center;
padding: 1.5rem;
text-align: center;
animation: splash-push 2400ms cubic-bezier(0.16, 1, 0.3, 1) both;
animation-delay: var(--splash-t0, 0ms);
}
#startup-splash-plate {
position: relative;
width: 3.25rem;
height: 3.25rem;
animation: splash-impact 460ms ease-out both;
animation-delay: calc(var(--splash-t0, 0ms) + 540ms);
}
#startup-splash-plate-fill,
#startup-splash .splash-ring {
position: absolute;
inset: 0;
border-radius: 0.375rem;
}
#startup-splash-plate-fill {
background: var(--splash-fg);
animation:
splash-plate 620ms cubic-bezier(0.34, 1.56, 0.64, 1) both,
splash-thump 2800ms cubic-bezier(0.22, 1, 0.36, 1) infinite;
animation-delay:
calc(var(--splash-t0, 0ms) + 520ms),
calc(var(--splash-t0, 0ms) + 2000ms);
}
#startup-splash .splash-ring {
border: 2px solid var(--splash-primary);
opacity: 0;
}
#startup-splash .splash-ring-intro {
animation: splash-ring 760ms cubic-bezier(0.16, 1, 0.3, 1);
animation-delay: calc(var(--splash-t0, 0ms) + 540ms);
}
/* Long waits (storage upgrades) keep a beat so the splash never looks frozen. */
#startup-splash .splash-ring-idle {
animation: splash-ring-idle 2800ms cubic-bezier(0.16, 1, 0.3, 1)
infinite;
animation-delay: calc(var(--splash-t0, 0ms) + 2000ms);
}
#startup-splash-mark {
position: absolute;
inset: 18.75%;
width: 62.5%;
height: 62.5%;
overflow: visible;
color: var(--splash-bg);
animation: splash-ink 180ms ease-out both;
animation-delay: calc(var(--splash-t0, 0ms) + 520ms);
}
/* Bands alternate sides; --band-i staggers the entry and exit, --band-g
sizes each band's glitch offset. */
#startup-splash .splash-band {
--band-x: -320px;
--band-i: 0;
--band-g: 10px;
animation: splash-band-in 760ms cubic-bezier(0.16, 1, 0.3, 1) both;
animation-delay: calc(var(--splash-t0, 0ms) + var(--band-i) * 55ms);
}
#startup-splash .splash-band:nth-child(2) {
--band-x: 320px;
--band-i: 1;
--band-g: -14px;
}
#startup-splash .splash-band:nth-child(3) {
--band-i: 2;
--band-g: 6px;
}
#startup-splash .splash-band:nth-child(4) {
--band-x: 320px;
--band-i: 3;
--band-g: -8px;
}
#startup-splash .splash-band:nth-child(5) {
--band-i: 4;
--band-g: 16px;
}
#startup-splash .splash-band:nth-child(6) {
--band-x: 320px;
--band-i: 5;
--band-g: -6px;
}
#startup-splash .splash-band-glitch {
animation: splash-glitch 3200ms steps(1, end) infinite;
animation-delay: calc(var(--splash-t0, 0ms) + 1600ms);
}
#startup-splash .splash-band-ghost {
stroke: var(--splash-primary);
opacity: 0;
animation: splash-ghost 3200ms steps(1, end) infinite;
animation-delay: calc(var(--splash-t0, 0ms) + 1600ms);
}
#startup-splash-word {
margin-top: 0.875rem;
font-size: 1.0625rem;
font-weight: 600;
line-height: 1;
letter-spacing: -0.01em;
}
#startup-splash-word span {
--letter-x: -0.75rem;
--letter-i: 0;
display: inline-block;
animation: splash-letter 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
animation-delay: calc(
var(--splash-t0, 0ms) + 560ms + var(--letter-i) * 45ms
);
}
#startup-splash-word span:nth-child(2) {
--letter-x: 0.75rem;
--letter-i: 1;
}
#startup-splash-word span:nth-child(3) {
--letter-i: 2;
}
#startup-splash-word span:nth-child(4) {
--letter-x: 0.75rem;
--letter-i: 3;
}
#startup-splash-word span:nth-child(5) {
--letter-i: 4;
}
#startup-splash-status {
width: min(21rem, calc(100vw - 3rem));
margin: 1.125rem 0 0;
overflow: hidden;
color: var(--splash-muted);
font-size: 0.875rem;
line-height: 1.25rem;
white-space: nowrap;
text-overflow: ellipsis;
animation: splash-fade 420ms ease-out both;
animation-delay: calc(var(--splash-t0, 0ms) + 300ms);
}
/* Each status change re-adds this class so the copy swaps with a short lift
instead of snapping between sentences. */
#startup-splash-status.is-swapping {
animation: splash-status-swap 200ms ease-out both;
}
#startup-splash-detail {
margin: 0;
color: var(--splash-muted);
font-size: 0.75rem;
line-height: 1.25rem;
}
#startup-splash-meter {
width: min(12rem, calc(100vw - 3rem));
height: 0.125rem;
margin-top: 0.375rem;
overflow: hidden;
border-radius: 999px;
background: var(--splash-border);
animation: splash-fade 420ms ease-out both;
animation-delay: calc(var(--splash-t0, 0ms) + 300ms);
}
#startup-splash-fill {
position: relative;
display: block;
overflow: hidden;
width: 100%;
height: 100%;
border-radius: inherit;
background: var(--splash-primary);
transform: scaleX(0.92);
transform-origin: left center;
transition: transform 180ms ease-out;
animation: splash-meter 2600ms cubic-bezier(0.22, 1, 0.36, 1) both;
animation-delay: calc(var(--splash-t0, 0ms) + 300ms);
}
#startup-splash-fill::after {
content: "";
position: absolute;
inset: 0;
width: 40%;
background: linear-gradient(
90deg,
transparent,
color-mix(in oklab, var(--splash-primary) 45%, white),
transparent
);
transform: translateX(-100%);
animation: splash-shimmer 1800ms ease-in-out infinite;
animation-delay: calc(var(--splash-t0, 0ms) + 1200ms);
}
#startup-splash.is-complete #startup-splash-fill {
transform: scaleX(1);
animation: none;
}
#startup-splash-version {
position: absolute;
bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
left: 50%;
margin: 0;
color: var(--splash-muted);
font-size: 0.75rem;
line-height: 1rem;
letter-spacing: 0.04em;
white-space: nowrap;
opacity: 0.7;
transform: translateX(-50%) scale(var(--nerve-inverse-zoom-scale, 1));
transform-origin: center bottom;
animation: splash-fade 600ms ease-out both;
animation-delay: calc(var(--splash-t0, 0ms) + 900ms);
}
/* Exit. Copy leaves first, the plate drops out so the bands leave in full
colour, then the bands slide back out while the backdrop clears. */
#startup-splash.is-dismissed #startup-splash-word,
#startup-splash.is-dismissed #startup-splash-status,
#startup-splash.is-dismissed #startup-splash-detail,
#startup-splash.is-dismissed #startup-splash-meter {
animation: splash-text-out 240ms cubic-bezier(0.5, 0, 0.75, 0) both;
}
#startup-splash.is-dismissed #startup-splash-grid,
#startup-splash.is-dismissed #startup-splash-version {
animation: splash-out 240ms ease-in both;
}
#startup-splash.is-dismissed #startup-splash-plate,
#startup-splash.is-dismissed .splash-ring,
#startup-splash.is-dismissed .splash-band-glitch,
#startup-splash.is-dismissed .splash-band-ghost {
animation: none;
}
#startup-splash.is-dismissed #startup-splash-plate-fill {
animation: splash-out 140ms ease-in both;
}
#startup-splash.is-dismissed #startup-splash-mark {
animation: splash-ink-out 120ms ease-in both;
}
#startup-splash.is-dismissed .splash-band {
animation: splash-band-out 360ms cubic-bezier(0.7, 0, 0.84, 0) both;
animation-delay: calc(80ms + var(--band-i) * 30ms);
}
@keyframes splash-push {
from {
transform: scale(1.035);
}
}
@keyframes splash-fade {
from {
opacity: 0;
}
}
@keyframes splash-out {
to {
opacity: 0;
}
}
@keyframes splash-backdrop-out {
to {
background-color: transparent;
}
}
@keyframes splash-band-in {
from {
opacity: 0;
transform: translateX(var(--band-x));
}
40% {
opacity: 1;
}
}
@keyframes splash-band-out {
60% {
opacity: 1;
}
to {
opacity: 0;
transform: translateX(var(--band-x));
}
}
@keyframes splash-plate {
from {
opacity: 0;
transform: scale(0.3);
}
}
@keyframes splash-impact {
25% {
transform: scale(1.1, 0.9);
}
55% {
transform: scale(0.96, 1.04);
}
}
@keyframes splash-ring {
from {
opacity: 0.9;
transform: scale(1);
}
to {
opacity: 0;
transform: scale(2.4);
}
}
@keyframes splash-ring-idle {
0% {
opacity: 0.6;
transform: scale(1);
}
45%,
100% {
opacity: 0;
transform: scale(1.9);
}
}
@keyframes splash-thump {
8% {
transform: scale(1.06);
}
30%,
100% {
transform: scale(1);
}
}
@keyframes splash-ink {
from {
color: var(--splash-fg);
}
}
@keyframes splash-ink-out {
from {
color: var(--splash-bg);
}
to {
color: var(--splash-fg);
}
}
@keyframes splash-glitch {
0%,
86% {
transform: translateX(0);
}
88% {
transform: translateX(var(--band-g));
}
90% {
transform: translateX(calc(var(--band-g) * -0.6));
}
92%,
100% {
transform: translateX(0);
}
}
@keyframes splash-ghost {
0%,
86% {
opacity: 0;
transform: translateX(0);
}
88% {
opacity: 0.9;
transform: translateX(-8px);
}
90% {
opacity: 0.9;
transform: translateX(8px);
}
92%,
100% {
opacity: 0;
transform: translateX(0);
}
}
@keyframes splash-letter {
from {
opacity: 0;
transform: translateX(var(--letter-x));
}
}
@keyframes splash-text-out {
to {
opacity: 0;
transform: translateY(0.25rem);
}
}
@keyframes splash-status-swap {
from {
opacity: 0;
transform: translateY(0.25rem);
}
}
@keyframes splash-meter {
from {
transform: scaleX(0.04);
}
}
@keyframes splash-shimmer {
to {
transform: translateX(250%);
}
}
@media (prefers-reduced-motion: reduce) {
#startup-splash,
#startup-splash *,
#startup-splash *::before,
#startup-splash *::after {
animation: none !important;
}
#startup-splash-fill::after {
display: none;
}
}
/* startup-splash:end */
`;

/** Canonical splash markup. The status text and version are escaped here. */
export function startupSplashMarkup(
  statusText: string,
  version: string | undefined,
): string {
  return `<!-- startup-splash:begin -->
<div id="startup-splash" aria-busy="true" aria-label="Starting Nerve">
<span id="startup-splash-grid" aria-hidden="true"></span>
<div id="startup-splash-content">
<div id="startup-splash-stage">
<div id="startup-splash-plate" aria-hidden="true">
<span class="splash-ring splash-ring-intro"></span>
<span class="splash-ring splash-ring-idle"></span>
<span id="startup-splash-plate-fill"></span>
<svg id="startup-splash-mark" viewBox="120 120 272 272" fill="none" focusable="false">
<defs>
<g id="startup-splash-n">
<path d="M150 350V162" />
<path d="M362 350V162" />
<path d="M150 162L232 235L258 208L284 288L362 350" />
</g>
<clipPath id="startup-splash-band-1"><rect x="100" y="119.5" width="312" height="46.34" /></clipPath>
<clipPath id="startup-splash-band-2"><rect x="100" y="164.83" width="312" height="46.34" /></clipPath>
<clipPath id="startup-splash-band-3"><rect x="100" y="210.17" width="312" height="46.34" /></clipPath>
<clipPath id="startup-splash-band-4"><rect x="100" y="255.5" width="312" height="46.34" /></clipPath>
<clipPath id="startup-splash-band-5"><rect x="100" y="300.83" width="312" height="46.34" /></clipPath>
<clipPath id="startup-splash-band-6"><rect x="100" y="346.17" width="312" height="46.34" /></clipPath>
</defs>
<g stroke="currentColor" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
<g class="splash-band"><g class="splash-band-glitch" clip-path="url(#startup-splash-band-1)"><use class="splash-band-ghost" href="#startup-splash-n" /><use href="#startup-splash-n" /></g></g>
<g class="splash-band"><g class="splash-band-glitch" clip-path="url(#startup-splash-band-2)"><use class="splash-band-ghost" href="#startup-splash-n" /><use href="#startup-splash-n" /></g></g>
<g class="splash-band"><g class="splash-band-glitch" clip-path="url(#startup-splash-band-3)"><use class="splash-band-ghost" href="#startup-splash-n" /><use href="#startup-splash-n" /></g></g>
<g class="splash-band"><g class="splash-band-glitch" clip-path="url(#startup-splash-band-4)"><use class="splash-band-ghost" href="#startup-splash-n" /><use href="#startup-splash-n" /></g></g>
<g class="splash-band"><g class="splash-band-glitch" clip-path="url(#startup-splash-band-5)"><use class="splash-band-ghost" href="#startup-splash-n" /><use href="#startup-splash-n" /></g></g>
<g class="splash-band"><g class="splash-band-glitch" clip-path="url(#startup-splash-band-6)"><use class="splash-band-ghost" href="#startup-splash-n" /><use href="#startup-splash-n" /></g></g>
</g>
</svg>
</div>
<div id="startup-splash-word" aria-hidden="true"><span>n</span><span>e</span><span>r</span><span>v</span><span>e</span></div>
<p id="startup-splash-status" aria-live="polite">${escapeHtml(statusText)}</p>
<p id="startup-splash-detail" hidden aria-live="polite"></p>
<div id="startup-splash-meter" role="progressbar" aria-label="Starting Nerve">
<span id="startup-splash-fill"></span>
</div>
</div>
</div>
<p id="startup-splash-version">${version ? `Nerve ${escapeHtml(version)}` : ""}</p>
</div>
<!-- startup-splash:end -->`;
}
