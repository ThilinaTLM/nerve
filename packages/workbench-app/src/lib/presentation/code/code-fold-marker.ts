/* Fold markers are created by CodeMirror whenever gutter lines render, so they
 * are cloned from a static SVG instead of mounting a component per marker. */
const CHEVRON_PATHS = {
  open: "m6 9 6 6 6-6",
  closed: "m9 18 6-6-6-6",
} as const;

const templates = new Map<boolean, HTMLElement>();

function markerTemplate(open: boolean): HTMLElement {
  const cached = templates.get(open);
  if (cached) return cached;
  const dom = document.createElement("span");
  dom.className = "cm-fold-marker";
  dom.dataset.open = String(open);
  dom.setAttribute("aria-hidden", "true");
  dom.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${open ? CHEVRON_PATHS.open : CHEVRON_PATHS.closed}"/></svg>`;
  templates.set(open, dom);
  return dom;
}

export function codeFoldMarker(open: boolean): HTMLElement {
  return markerTemplate(open).cloneNode(true) as HTMLElement;
}
