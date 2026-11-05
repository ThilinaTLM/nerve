import type { DeviceKind } from "@nervekit/contracts/access";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import {
  getPasskeyLoginOptions,
  getPasskeyRegistrationOptions,
  redeemPairingCode,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from "../api/access.api";

/** Redeems a pairing code; the server sets the device cookie. */
export async function pairThisDevice(input: {
  code: string;
  deviceName: string;
  kind: DeviceKind;
}): Promise<void> {
  await redeemPairingCode(input);
}

export async function signInWithPasskey(input: {
  deviceName: string;
  kind: DeviceKind;
}): Promise<void> {
  const optionsJSON = await getPasskeyLoginOptions();
  const response = await startAuthentication({ optionsJSON });
  await verifyPasskeyLogin({ response, ...input });
}

/** First enrollment with a setup code; signs this browser in as well. */
export async function enrollFirstPasskey(input: {
  setupCode: string;
  passkeyName: string;
  deviceName: string;
  kind: DeviceKind;
}): Promise<void> {
  const optionsJSON = await getPasskeyRegistrationOptions(input.setupCode);
  const response = await startRegistration({ optionsJSON });
  await verifyPasskeyRegistration({ response, ...input });
}

/** Adds another passkey to the signed-in owner (Settings → Devices). */
export async function addPasskey(passkeyName: string): Promise<void> {
  const optionsJSON = await getPasskeyRegistrationOptions();
  const response = await startRegistration({ optionsJSON });
  await verifyPasskeyRegistration({ response, passkeyName });
}
