export function withTimeoutSignal(
  signal: AbortSignal | undefined,
  milliseconds: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
