import { describeAccessError } from "./access-errors";

/** Busy/error bookkeeping for a form action that talks to the access API. */
export function createSubmitter() {
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);
  return {
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    clearError() {
      error = undefined;
    },
    /** Runs the action; resolves true on success, false after recording the error. */
    async run(action: () => Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      error = undefined;
      try {
        await action();
        return true;
      } catch (cause) {
        error = describeAccessError(cause);
        return false;
      } finally {
        busy = false;
      }
    },
  };
}
