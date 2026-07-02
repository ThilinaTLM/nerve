export type ManagerProtocolMessage = { type: string; [key: string]: unknown };
export function parseProtocolMessage(
  data: string | Buffer,
): ManagerProtocolMessage {
  return JSON.parse(String(data)) as ManagerProtocolMessage;
}
