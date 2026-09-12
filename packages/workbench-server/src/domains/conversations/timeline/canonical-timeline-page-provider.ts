import { randomBytes } from "node:crypto";
import type { SecretProvider } from "../../../infrastructure/secrets/index.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelinePageService } from "./canonical-timeline-page.service.js";

export function createTimelinePages(
  store: CanonicalStore,
  secrets: SecretProvider,
): CanonicalTimelinePageProvider {
  return new CanonicalTimelinePageProvider(store, secrets);
}

const CURSOR_SECRET_NAME = "canonical-timeline-cursor-hmac-v1";

/** Lazily loads the portable cursor key without putting file IO on page reads. */
export class CanonicalTimelinePageProvider {
  private service?: Promise<CanonicalTimelinePageService>;

  constructor(
    private readonly store: CanonicalStore,
    private readonly secrets: SecretProvider,
  ) {}

  async page(request: unknown) {
    this.service ??= this.createService();
    return (await this.service).page(request);
  }

  private async createService(): Promise<CanonicalTimelinePageService> {
    let encoded = await this.secrets.get(CURSOR_SECRET_NAME);
    if (!encoded) {
      encoded = randomBytes(32).toString("base64");
      await this.secrets.set(CURSOR_SECRET_NAME, encoded);
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32) {
      throw new Error("Canonical timeline cursor secret is invalid.");
    }
    return new CanonicalTimelinePageService(this.store, key);
  }
}
