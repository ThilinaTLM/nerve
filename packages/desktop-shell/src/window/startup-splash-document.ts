import { escapeHtml } from "./html.js";

/* The block between the `startup-splash` markers is the canonical splash
 * composition. `packages/workbench-app/index.html` mirrors it verbatim so the
 * Electron shell page and the workbench bootstrap render identical pixels, and
 * `scripts/lib/startup-splash-sync.test.mjs` fails the build on any drift.
 *
 * Rules for editing: only `--splash-*` custom properties may be referenced (each
 * host document declares them), every animation delay is offset by
 * `--splash-t0` so the workbench can resume the shell's timeline mid-flight, and
 * the base declarations must describe the *settled* composition so that reduced
 * motion and a finished timeline both land on the finished frame. */

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
transition:
opacity 280ms ease,
transform 280ms ease,
filter 280ms ease;
}
#startup-splash.is-dismissed {
opacity: 0;
transform: scale(1.03);
filter: blur(4px);
pointer-events: none;
}
#startup-splash-content {
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
display: grid;
place-items: center;
overflow: hidden;
width: 3rem;
height: 3rem;
border-radius: 0.625rem;
color: var(--splash-bg);
}
#startup-splash-plate::before {
content: "";
position: absolute;
inset: 0;
border-radius: inherit;
background: var(--splash-fg);
animation: splash-plate 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
animation-delay: calc(var(--splash-t0, 0ms) + 900ms);
}
#startup-splash-mark {
position: relative;
z-index: 1;
width: 62.5%;
height: 62.5%;
color: var(--splash-bg);
animation: splash-ink 420ms ease-out both;
animation-delay: calc(var(--splash-t0, 0ms) + 1050ms);
}
#startup-splash-mark path {
stroke-dasharray: 100;
stroke-dashoffset: 0;
animation: splash-draw 860ms cubic-bezier(0.65, 0, 0.35, 1) both;
}
#startup-splash-mark .splash-stem-left {
animation-delay: calc(var(--splash-t0, 0ms) + 60ms);
}
#startup-splash-mark .splash-stem-right {
animation-delay: calc(var(--splash-t0, 0ms) + 140ms);
}
#startup-splash-mark .splash-diagonal {
animation-duration: 900ms;
animation-delay: calc(var(--splash-t0, 0ms) + 240ms);
}
#startup-splash-sheen {
position: absolute;
z-index: 2;
top: -60%;
bottom: -60%;
left: -40%;
width: 34%;
background: linear-gradient(
90deg,
transparent,
color-mix(in oklab, var(--splash-bg) 65%, transparent),
transparent
);
transform: rotate(18deg) translateX(460%);
animation: splash-sheen 700ms cubic-bezier(0.4, 0, 0.2, 1) both;
animation-delay: calc(var(--splash-t0, 0ms) + 1350ms);
}
#startup-splash-word {
margin-top: 0.875rem;
font-size: 1.0625rem;
font-weight: 600;
line-height: 1;
letter-spacing: -0.01em;
}
#startup-splash-word span {
display: inline-block;
animation: splash-rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
#startup-splash-word span:nth-child(1) {
animation-delay: calc(var(--splash-t0, 0ms) + 1150ms);
}
#startup-splash-word span:nth-child(2) {
animation-delay: calc(var(--splash-t0, 0ms) + 1195ms);
}
#startup-splash-word span:nth-child(3) {
animation-delay: calc(var(--splash-t0, 0ms) + 1240ms);
}
#startup-splash-word span:nth-child(4) {
animation-delay: calc(var(--splash-t0, 0ms) + 1285ms);
}
#startup-splash-word span:nth-child(5) {
animation-delay: calc(var(--splash-t0, 0ms) + 1330ms);
}
#startup-splash-status {
width: min(21rem, calc(100vw - 3rem));
margin: 1.25rem 0 0;
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
#startup-splash-meter {
width: min(21rem, calc(100vw - 3rem));
height: 0.25rem;
margin-top: 0.5rem;
overflow: hidden;
border-radius: 999px;
background: var(--splash-border);
animation: splash-fade 420ms ease-out both;
animation-delay: calc(var(--splash-t0, 0ms) + 300ms);
}
#startup-splash-fill {
display: block;
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
#startup-splash.is-complete #startup-splash-fill {
transform: scaleX(1);
animation: none;
}
@keyframes splash-push {
from {
transform: scale(1.035);
}
}
@keyframes splash-plate {
from {
opacity: 0;
clip-path: inset(0 0 100% 0 round 0.625rem);
}
}
@keyframes splash-draw {
from {
stroke-dashoffset: 100;
}
}
@keyframes splash-ink {
from {
color: var(--splash-fg);
}
}
@keyframes splash-sheen {
from {
transform: rotate(18deg) translateX(-260%);
}
}
@keyframes splash-rise {
from {
opacity: 0;
transform: translateY(0.5rem);
}
}
@keyframes splash-fade {
from {
opacity: 0;
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
/* The settled composition is the base state, so suppressing the intro is enough
   for reduced motion and for the desktop hand-off after the shell already
   played it. */
:root[data-splash-intro="settled"] #startup-splash *,
:root[data-splash-intro="settled"] #startup-splash *::before {
animation: none !important;
}
@media (prefers-reduced-motion: reduce) {
#startup-splash {
transition-duration: 1ms;
}
#startup-splash *,
#startup-splash *::before {
animation: none !important;
}
}
/* startup-splash:end */
`;

/** Canonical splash markup. The status text is escaped here. */
export function startupSplashMarkup(statusText: string): string {
  return `<!-- startup-splash:begin -->
<div id="startup-splash" aria-busy="true" aria-label="Starting Nerve">
<div id="startup-splash-content">
<div id="startup-splash-stage">
<div id="startup-splash-plate" aria-hidden="true">
<svg id="startup-splash-mark" viewBox="120 120 272 272" fill="none" focusable="false">
<g stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
<path class="splash-stem-left" pathLength="100" d="M150 350V162" />
<path class="splash-stem-right" pathLength="100" d="M362 350V162" />
<path class="splash-diagonal" pathLength="100" d="M150 162L232 235L258 208L284 288L362 350" />
</g>
</svg>
<span id="startup-splash-sheen"></span>
</div>
<div id="startup-splash-word" aria-hidden="true"><span>n</span><span>e</span><span>r</span><span>v</span><span>e</span></div>
<p id="startup-splash-status" aria-live="polite">${escapeHtml(statusText)}</p>
<div id="startup-splash-meter" role="progressbar" aria-label="Starting Nerve">
<span id="startup-splash-fill"></span>
</div>
</div>
</div>
</div>
<!-- startup-splash:end -->`;
}
