import { FrameCoalescer } from "./frame-coalescer";

/**
 * Keeps a frame-coalesced visual snapshot while canonical conversation state
 * continues to update synchronously. Hidden panes retain only their latest
 * value and flush it immediately when activated again.
 */
export function createConversationRenderProjection<T>(options: {
  initialScope: string | undefined;
  initialActive: boolean;
  initialValue: T;
}) {
  let current = $state.raw(options.initialValue);
  let scope = options.initialScope;
  let active = options.initialActive;
  const coalescer = new FrameCoalescer<T>((value) => {
    current = value;
  });

  return {
    get current(): T {
      return current;
    },
    update(nextScope: string | undefined, nextActive: boolean, value: T): void {
      const scopeChanged = nextScope !== scope;
      const becameActive = nextActive && !active;
      scope = nextScope;
      active = nextActive;

      if (scopeChanged || becameActive) {
        coalescer.flushNow(value);
      } else if (nextActive) {
        coalescer.enqueue(value);
      } else {
        coalescer.hold(value);
      }
    },
    destroy(): void {
      coalescer.destroy();
    },
  };
}
