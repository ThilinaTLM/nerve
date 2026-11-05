import {
  browserPollEnvironment,
  createPoll,
  type PollClock,
} from "$lib/platform/polling/poll";

export function startPwaUpdateScheduler(options: {
  checkForUpdate: () => unknown;
  intervalMs?: number;
  minimumCheckIntervalMs?: number;
  clock?: PollClock;
  window?: Parameters<typeof browserPollEnvironment>[0];
  document?: Parameters<typeof browserPollEnvironment>[1];
}): () => void {
  const poll = createPoll({
    run: options.checkForUpdate,
    intervalMs: options.intervalMs ?? 60 * 60_000,
    minGapMs: options.minimumCheckIntervalMs ?? 60_000,
    // Update checks are best-effort; failures are not worth a log line each hour.
    onError: () => undefined,
    clock: options.clock,
    environment: browserPollEnvironment(options.window, options.document),
  });
  poll.start();
  return () => poll.stop();
}
