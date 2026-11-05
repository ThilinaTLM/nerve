import type {
  AccessAuditEvent,
  AccessSession,
  Device,
  DeviceGrant,
  DeviceKind,
  ListDevicesResponse,
  PairingCode,
  PairingPurpose,
  Passkey,
  PasskeyRegisterVerifyResponse,
} from "@nervekit/contracts/access";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPathSegment,
  apiPost,
} from "$lib/platform/http/api-client";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";

export function getAccessSession(): Promise<AccessSession> {
  return apiGet<AccessSession>("/api/access/session");
}

export function redeemPairingCode(input: {
  code: string;
  deviceName: string;
  kind: DeviceKind;
}): Promise<DeviceGrant> {
  return apiPost<DeviceGrant>("/api/access/pair", {
    ...input,
    delivery: "cookie",
  });
}

export async function getPasskeyLoginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return (
    await apiPost<{ options: PublicKeyCredentialRequestOptionsJSON }>(
      "/api/access/login/options",
      {},
    )
  ).options;
}

export function verifyPasskeyLogin(input: {
  response: AuthenticationResponseJSON;
  deviceName: string;
  kind: DeviceKind;
}): Promise<DeviceGrant> {
  return apiPost<DeviceGrant>("/api/access/login/verify", {
    ...input,
    delivery: "cookie",
  });
}

/** `setupCode` is for first enrollment before any session exists. */
export async function getPasskeyRegistrationOptions(
  setupCode?: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return (
    await apiPost<{ options: PublicKeyCredentialCreationOptionsJSON }>(
      "/api/access/passkeys/register/options",
      setupCode ? { setupCode } : {},
    )
  ).options;
}

export function verifyPasskeyRegistration(input: {
  setupCode?: string;
  response: RegistrationResponseJSON;
  passkeyName: string;
  deviceName?: string;
  kind?: DeviceKind;
}): Promise<PasskeyRegisterVerifyResponse> {
  return apiPost<PasskeyRegisterVerifyResponse>(
    "/api/access/passkeys/register/verify",
    { ...input, delivery: "cookie" },
  );
}

export function createPairingCode(
  purpose: PairingPurpose,
  ttlSeconds?: number,
): Promise<PairingCode> {
  return apiPost<PairingCode>("/api/access/pairing-codes", {
    purpose,
    ...(ttlSeconds ? { ttlSeconds } : {}),
  });
}

export function listDevices(): Promise<ListDevicesResponse> {
  return apiGet<ListDevicesResponse>("/api/access/devices");
}

export async function renameDevice(id: string, name: string): Promise<Device> {
  return (
    await apiPatch<{ device: Device }>(
      `/api/access/devices/${apiPathSegment(id)}`,
      { name },
    )
  ).device;
}

export async function revokeDevice(id: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/access/devices/${apiPathSegment(id)}`);
}

export async function revokeAllDevices(keepCurrent = true): Promise<number> {
  return (
    await apiPost<{ revoked: number }>("/api/access/devices/revoke-all", {
      keepCurrent,
    })
  ).revoked;
}

export async function listPasskeys(): Promise<Passkey[]> {
  return (await apiGet<{ passkeys: Passkey[] }>("/api/access/passkeys"))
    .passkeys;
}

export async function removePasskey(id: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/access/passkeys/${apiPathSegment(id)}`);
}

export async function listAuditEvents(limit = 50): Promise<AccessAuditEvent[]> {
  return (
    await apiGet<{ events: AccessAuditEvent[] }>(
      `/api/access/audit?limit=${limit}`,
    )
  ).events;
}
