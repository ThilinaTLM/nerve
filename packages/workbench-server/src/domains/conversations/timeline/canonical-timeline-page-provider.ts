import { randomBytes } from "node:crypto";
import type { SecretProvider } from "../../../infrastructure/secrets/index.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelinePageService } from "./canonical-timeline-page.service.js";
import { CanonicalTimelineTreePageService } from "./canonical-timeline-tree-page.service.js";
import { CanonicalTimelineSearchService } from "./canonical-timeline-search.service.js";

export function createTimelinePages(
  store: CanonicalStore,
  secrets: SecretProvider,
  canAccess?: (conversationId: string) => boolean,
): CanonicalTimelinePageProvider {
  return new CanonicalTimelinePageProvider(store, secrets, canAccess);
}

const CURSOR_SECRET_NAME = "canonical-timeline-cursor-hmac-v1";

/** Lazily loads the portable cursor key without putting file IO on page reads. */
export class CanonicalTimelinePageProvider {
  private services?: Promise<{
    timeline: CanonicalTimelinePageService;
    tree: CanonicalTimelineTreePageService;
    search: CanonicalTimelineSearchService;
  }>;

  constructor(
    private readonly store: CanonicalStore,
    private readonly secrets: SecretProvider,
    private readonly canAccess: (conversationId: string) => boolean = () =>
      true,
  ) {}

  async page(request: unknown) {
    this.services ??= this.createServices();
    return (await this.services).timeline.page(request);
  }

  deletionStatus(conversationId: string) {
    return this.store.deletion.readIntent(conversationId);
  }

  projectionStatus(conversationId: string) {
    return this.store.readTimelineTranscriptProjectionStatus(conversationId);
  }

  async search(request: unknown) {
    this.services ??= this.createServices();
    return (await this.services).search.search(request);
  }

  async treePage(request: unknown) {
    this.services ??= this.createServices();
    return (await this.services).tree.page(request);
  }

  private async createServices() {
    let encoded = await this.secrets.get(CURSOR_SECRET_NAME);
    if (!encoded) {
      encoded = randomBytes(32).toString("base64");
      await this.secrets.set(CURSOR_SECRET_NAME, encoded);
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32) {
      throw new Error("Canonical timeline cursor secret is invalid.");
    }
    return {
      timeline: new CanonicalTimelinePageService(
        this.store,
        key,
        this.canAccess,
      ),
      tree: new CanonicalTimelineTreePageService(
        this.store,
        key,
        this.canAccess,
      ),
      search: new CanonicalTimelineSearchService(
        this.store,
        key,
        this.canAccess,
      ),
    };
  }
}
