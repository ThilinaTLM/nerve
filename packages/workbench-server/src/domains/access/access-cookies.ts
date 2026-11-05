import {
  SECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@nervekit/contracts/access";

/**
 * Session cookie for a device. `Secure` (and the `__Host-` prefix) whenever
 * the connection is HTTPS; plain loopback keeps the unprefixed name.
 */
export function sessionCookie(input: {
  credential: string;
  expiresAt: number;
  secure: boolean;
}): string {
  const name = input.secure ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
  return `${name}=${encodeURIComponent(input.credential)}; Path=/; SameSite=Strict; HttpOnly; Expires=${new Date(input.expiresAt).toUTCString()}${input.secure ? "; Secure" : ""}`;
}

/** Clears both cookie names (the prefixed one needs Secure to be accepted). */
export function clearSessionCookies(): string[] {
  const expired = "Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  return [
    `${SESSION_COOKIE_NAME}=; Path=/; SameSite=Strict; HttpOnly; ${expired}`,
    `${SECURE_SESSION_COOKIE_NAME}=; Path=/; SameSite=Strict; HttpOnly; Secure; ${expired}`,
  ];
}
