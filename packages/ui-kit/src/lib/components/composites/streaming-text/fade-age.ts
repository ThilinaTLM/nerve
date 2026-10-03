/**
 * Sets a fresh chunk's negative animation-delay once, at mount. The delay is
 * the chunk's age, so a span recreated mid-fade continues where it was.
 * Never updated afterwards: changing the delay of a running animation would
 * shift its progress a second time.
 */
export function fadeAge(node: HTMLElement, ageMs: number): void {
  if (ageMs > 0) node.style.animationDelay = `${-Math.round(ageMs)}ms`;
}
