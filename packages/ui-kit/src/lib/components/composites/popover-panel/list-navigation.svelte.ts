type Options<T> = {
  /** Current, already filtered items in render order. */
  items: () => T[];
  /** Stable id for the rendered row element (used by aria-activedescendant). */
  getId: (item: T) => string;
  /** Scroll container holding the rows. */
  viewport?: () => HTMLElement | undefined;
  onChoose: (item: T) => void;
};

/** Roving keyboard navigation for a popover option list.
 *
 * Owns the "active" row — the keyboard highlight, which is deliberately not the
 * same thing as the selected value — so every searchable panel (projects,
 * branches, repositories) navigates identically instead of each picker
 * reinventing arrow handling. */
export function createListNavigation<T>(options: Options<T>) {
  let index = $state(-1);

  function clamp(next: number, count: number): number {
    if (count === 0) return -1;
    return Math.min(Math.max(next, 0), count - 1);
  }

  function scrollActiveIntoView(): void {
    const item = options.items()[index];
    if (!item) return;
    const id = options.getId(item);
    requestAnimationFrame(() => {
      options
        .viewport?.()
        ?.querySelector(`[id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function move(delta: number): void {
    const count = options.items().length;
    if (count === 0) return;
    const start = index < 0 ? (delta > 0 ? 0 : count - 1) : index + delta;
    index = clamp(start, count);
    scrollActiveIntoView();
  }

  return {
    get index() {
      return index;
    },
    /** The row id to expose through `aria-activedescendant`. */
    get activeDescendant(): string | undefined {
      const item = options.items()[index];
      return item ? options.getId(item) : undefined;
    },
    isActive(position: number): boolean {
      return position === index;
    },
    reset(): void {
      index = -1;
    },
    /** Chooses the active row, falling back to the first match. */
    chooseActive(): void {
      const items = options.items();
      const target = items[index >= 0 ? index : 0];
      if (target) options.onChoose(target);
    },
    handleKeydown(event: KeyboardEvent): void {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "Home":
          event.preventDefault();
          index = clamp(0, options.items().length);
          scrollActiveIntoView();
          break;
        case "End":
          event.preventDefault();
          index = clamp(options.items().length - 1, options.items().length);
          scrollActiveIntoView();
          break;
        default:
          break;
      }
    },
  };
}
