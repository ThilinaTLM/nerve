export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
