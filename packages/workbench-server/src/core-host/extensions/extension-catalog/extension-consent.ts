import type { TrustedResourceService } from "@nervekit/conversation-core";
import { toTrustedDigest } from "@nervekit/contracts/core";
import { hashExtensionContent } from "./content-hash.js";
import {
  buildConsent,
  grantSnapshot,
  newGrants,
  isEmptyGrant,
} from "./consent-summary.js";
import type {
  ExtensionTrustGate,
  ExtensionTrustVerdict,
  InstalledExtensionCandidate,
  InstalledExtensionKey,
} from "./trust-gate.js";

/** What the consent store needs of the host: the trust service and the project behind a directory. */
export type ExtensionConsentSources = {
  trust: () => TrustedResourceService;
  /** The id of the registered project with this directory; absent when none is. */
  projectIdOf: (projectDir: string) => string | undefined;
};

/** The registered project whose directory this is (a trailing slash does not matter). */
export function projectIdOfDirectory(
  projects: { list(): readonly { id: string; directory: string }[] },
  directory: string,
): string | undefined {
  const bare = (path: string) => path.replace(/\/+$/, "");
  return projects.list().find((p) => bare(p.directory) === bare(directory))?.id;
}

/**
 * Consent to installed extensions: `extension` rows of `trusted_resource`
 * (docs/architecture/trust.md). One decision per folder, scoped to the project for a project
 * extension; `name` is the extension id, `content_digest` the hash of its `dist/`, and `grants`
 * what the user approved. Rules:
 *
 * - Nothing runs before consent; a missing, `rejected` or unreadable decision is pending review.
 * - A project extension is pending again on any change of its content.
 * - A user extension keeps consent through a code-only change; a change that adds anything to
 *   its grants (network, accounts, models, frame, namespaces and operations, tools, UI) is pending
 *   again, with the new grants as the review. Removed grants narrow the stored snapshot.
 */
export class ExtensionConsentRepository implements ExtensionTrustGate {
  constructor(private readonly sources: ExtensionConsentSources) {}

  async decide(
    candidate: InstalledExtensionCandidate,
  ): Promise<"trusted" | ExtensionTrustVerdict> {
    const scope = this.#scope(candidate);
    const contentHash = await hashExtensionContent(candidate.folder);
    const record = scope
      ? this.#find(scope.projectId, candidate.folder)
      : undefined;
    const approved = record?.status === "trusted" ? record : undefined;
    if (approved && approved.contentDigest === toTrustedDigest(contentHash))
      return "trusted";
    const grants = grantSnapshot(candidate.manifest);
    if (
      scope &&
      approved?.grants &&
      candidate.source === "user" &&
      isEmptyGrant(newGrants(approved.grants, grants))
    ) {
      // Code-only change (or fewer grants): consent stands, and is narrowed to what is granted now.
      this.sources.trust().decide({
        kind: "extension",
        projectId: scope.projectId,
        resourceKey: candidate.folder,
        name: candidate.id,
        contentDigest: toTrustedDigest(contentHash),
        status: "trusted",
        grants,
      });
      return "trusted";
    }
    return {
      decision: "pending",
      consent: buildConsent({
        manifest: candidate.manifest,
        contentHash,
        ...(approved?.grants ? { previous: approved.grants } : {}),
      }),
    };
  }

  async grant(
    candidate: InstalledExtensionCandidate,
    contentHash: string,
  ): Promise<boolean> {
    const scope = this.#scope(candidate);
    if (!scope) return false;
    // The hash is of the files as they are now: consent never covers files the user did not review.
    if ((await hashExtensionContent(candidate.folder)) !== contentHash)
      return false;
    this.sources.trust().decide({
      kind: "extension",
      projectId: scope.projectId,
      resourceKey: candidate.folder,
      name: candidate.id,
      contentDigest: toTrustedDigest(contentHash),
      status: "trusted",
      grants: grantSnapshot(candidate.manifest),
    });
    return true;
  }

  /** Keeps the row as `rejected`, so Settings can still show the decision. */
  async revoke(key: InstalledExtensionKey): Promise<void> {
    const scope = this.#scope(key);
    const record = scope ? this.#find(scope.projectId, key.folder) : undefined;
    if (!scope || !record) return;
    this.sources.trust().decide({
      kind: "extension",
      projectId: scope.projectId,
      resourceKey: key.folder,
      name: key.id,
      contentDigest: record.contentDigest,
      status: "rejected",
    });
  }

  #find(projectId: string | null, folder: string) {
    try {
      return (
        this.sources.trust().find("extension", projectId, folder) ?? undefined
      );
    } catch {
      // An unreadable record is untrusted (never the other way around); the next decision replaces it.
      return undefined;
    }
  }

  /** Where a decision for this extension is stored; absent for a project extension of no registered project. */
  #scope(key: InstalledExtensionKey): { projectId: string | null } | undefined {
    if (key.source === "user") return { projectId: null };
    const projectId = key.projectDir
      ? this.sources.projectIdOf(key.projectDir)
      : undefined;
    return projectId ? { projectId } : undefined;
  }
}

/** Consent sources over a conversation core that may not exist yet when the catalog is built. */
export function consentSourcesOf(
  core: () => {
    trust: TrustedResourceService;
    projects: { list(): readonly { id: string; directory: string }[] };
  },
): ExtensionConsentSources {
  return {
    trust: () => core().trust,
    projectIdOf: (directory) =>
      projectIdOfDirectory(core().projects, directory),
  };
}
