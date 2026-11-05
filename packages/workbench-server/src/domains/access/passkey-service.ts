import { createHash, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Passkey } from "@nervekit/contracts/access";
import type { PasskeyRecord } from "../../infrastructure/storage-bootstrap/devices-file.js";
import { AccessError } from "./access-error.js";
import type { DeviceStore } from "./device-store.js";

const CHALLENGE_TTL_MS = 2 * 60_000;
const MAX_CHALLENGES = 200;
const OWNER_USER_ID = createHash("sha256").update("nerve-owner").digest();

export function toPasskey(record: PasskeyRecord): Passkey {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

/**
 * Owner passkeys via `@simplewebauthn/server`. Challenges are single-use,
 * memory-only and expire after two minutes. Relying-party id and origin come
 * from the configured `publicUrl`, never from request headers.
 */
export class PasskeyService {
  readonly #challenges = new Map<
    string,
    { kind: "register" | "login"; expiresAt: number; binding?: string }
  >();

  constructor(
    private readonly store: DeviceStore,
    private readonly publicUrl: () => URL | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  #relyingParty(): { rpID: string; origin: string } {
    const url = this.publicUrl();
    if (!url) {
      throw new AccessError(
        409,
        "PUBLIC_URL_REQUIRED",
        "Passkeys need network.publicUrl to be configured.",
      );
    }
    return { rpID: url.hostname, origin: url.origin };
  }

  #remember(
    challenge: string,
    kind: "register" | "login",
    binding?: string,
  ): void {
    const now = this.now();
    for (const [key, value] of this.#challenges) {
      if (value.expiresAt <= now) this.#challenges.delete(key);
    }
    if (this.#challenges.size >= MAX_CHALLENGES) {
      const oldest = this.#challenges.keys().next().value;
      if (oldest !== undefined) this.#challenges.delete(oldest);
    }
    this.#challenges.set(challenge, {
      kind,
      expiresAt: now + CHALLENGE_TTL_MS,
      binding,
    });
  }

  #take(
    challenge: string,
    kind: "register" | "login",
    binding?: string,
  ): boolean {
    const found = this.#challenges.get(challenge);
    if (!found) return false;
    this.#challenges.delete(challenge);
    return (
      found.kind === kind &&
      found.expiresAt > this.now() &&
      found.binding === binding
    );
  }

  async registrationOptions(
    binding?: string,
  ): Promise<Record<string, unknown>> {
    const { rpID } = this.#relyingParty();
    const existing = await this.store.passkeys();
    const options = await generateRegistrationOptions({
      rpName: "Nerve",
      rpID,
      userName: "owner",
      userDisplayName: "Nerve owner",
      userID: OWNER_USER_ID,
      challenge: randomBytes(32),
      attestationType: "none",
      excludeCredentials: existing.map((record) => ({
        id: record.id,
        transports: record.transports as never,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    this.#remember(options.challenge, "register", binding);
    return options as unknown as Record<string, unknown>;
  }

  async verifyRegistration(
    response: Record<string, unknown>,
    name: string,
    binding?: string,
  ): Promise<PasskeyRecord> {
    const { rpID, origin } = this.#relyingParty();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge: (challenge) =>
          this.#take(challenge, "register", binding),
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (error) {
      throw verificationFailed(error);
    }
    if (!verification.verified) throw verificationFailed();
    const { credential } = verification.registrationInfo;
    const record: PasskeyRecord = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports,
      name: name.slice(0, 80),
      createdAt: this.now(),
    };
    await this.store.addPasskey(record);
    return record;
  }

  async loginOptions(): Promise<Record<string, unknown>> {
    const { rpID } = this.#relyingParty();
    const passkeys = await this.store.passkeys();
    if (passkeys.length === 0) {
      throw new AccessError(
        409,
        "PASSKEY_NOT_ENROLLED",
        "No passkey is enrolled on this server.",
      );
    }
    const options = await generateAuthenticationOptions({
      rpID,
      challenge: randomBytes(32),
      userVerification: "preferred",
      allowCredentials: passkeys.map((record) => ({
        id: record.id,
        transports: record.transports as never,
      })),
    });
    this.#remember(options.challenge, "login");
    return options as unknown as Record<string, unknown>;
  }

  /** Returns the passkey that signed the assertion. */
  async verifyLogin(response: Record<string, unknown>): Promise<PasskeyRecord> {
    const { rpID, origin } = this.#relyingParty();
    const id = typeof response.id === "string" ? response.id : "";
    const record = (await this.store.passkeys()).find(
      (entry) => entry.id === id,
    );
    if (!record) throw verificationFailed();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge: (challenge) => this.#take(challenge, "login"),
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: record.id,
          publicKey: Buffer.from(record.publicKey, "base64url"),
          counter: record.counter,
          transports: record.transports,
        },
        requireUserVerification: false,
      });
    } catch (error) {
      throw verificationFailed(error);
    }
    if (!verification.verified) throw verificationFailed();
    await this.store.updatePasskeyUse(
      record.id,
      verification.authenticationInfo.newCounter,
    );
    return record;
  }
}

function verificationFailed(error?: unknown): AccessError {
  void error;
  return new AccessError(
    401,
    "PASSKEY_VERIFICATION_FAILED",
    "Passkey verification failed.",
  );
}
