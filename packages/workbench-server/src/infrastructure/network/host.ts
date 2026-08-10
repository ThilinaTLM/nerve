/**
 * Host predicates shared between the daemon (workbench-server) and the desktop
 * shell. They used to be duplicated in workbench-server/src/main.ts and
 * desktop-shell/src/daemon/urls.ts; this module is the single source of truth.
 */

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

export function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function isVirtualInterface(name: string): boolean {
  return /^(br-|docker|veth|virbr|vmnet|vboxnet|lo)/i.test(name);
}
