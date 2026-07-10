export type ReconnectPolicy = {
  minDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  jitter?: boolean;
};
export function reconnectDelay(
  attempt: number,
  policy: ReconnectPolicy = {},
): number {
  const min = policy.minDelayMs ?? 500;
  const max = policy.maxDelayMs ?? 30_000;
  const raw = Math.min(
    max,
    min * (policy.multiplier ?? 2) ** Math.max(0, attempt - 1),
  );
  return policy.jitter ? Math.floor(raw * (0.5 + Math.random())) : raw;
}
