export const MERMAID_PRELOAD_MARGIN = "300px 0px";

type MermaidVisibilityObserver = Pick<
  IntersectionObserver,
  "disconnect" | "observe" | "unobserve"
>;

type MermaidVisibilityObserverFactory = (
  callback: IntersectionObserverCallback,
  options: IntersectionObserverInit,
) => MermaidVisibilityObserver;

type MermaidVisibilityOptions = {
  root: Element | null;
  mount: (host: Element) => void;
  createObserver?: MermaidVisibilityObserverFactory;
};

export function observeMermaidVisibility(
  hosts: Iterable<Element>,
  options: MermaidVisibilityOptions,
): () => void {
  const pending = new Set(hosts);
  let active = true;

  const mountOnce = (host: Element) => {
    if (!active || !pending.delete(host)) return;
    options.mount(host);
  };

  const createObserver =
    options.createObserver ??
    (typeof IntersectionObserver === "undefined"
      ? undefined
      : (
          callback: IntersectionObserverCallback,
          init: IntersectionObserverInit,
        ) => new IntersectionObserver(callback, init));

  if (!createObserver) {
    for (const host of [...pending]) mountOnce(host);
    return () => {
      active = false;
      pending.clear();
    };
  }

  const observer = createObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !pending.has(entry.target)) continue;
        observer.unobserve(entry.target);
        mountOnce(entry.target);
      }
    },
    {
      root: options.root,
      rootMargin: MERMAID_PRELOAD_MARGIN,
      threshold: 0,
    },
  );

  for (const host of pending) observer.observe(host);

  return () => {
    active = false;
    pending.clear();
    observer.disconnect();
  };
}
