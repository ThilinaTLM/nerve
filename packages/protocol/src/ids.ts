export type IdFactory = (prefix: string) => string;

export const createProtocolId: IdFactory = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
  return `${prefix}_${uuid.replaceAll("-", "")}`;
};

function fallbackUuid(): string {
  const random = Math.random().toString(16).slice(2);
  return `${Date.now().toString(16)}${random}`;
}
