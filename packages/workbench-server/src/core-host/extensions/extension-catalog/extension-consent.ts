import type { TrustedResourceService } from "@nervekit/conversation-core";
import { toTrustedDigest } from "@nervekit/contracts/core";
import { extensionGrantSnapshotSchema } from "@nervekit/contracts/extensions";
import { hashExtensionContent } from "./content-hash.js";
import { buildConsent, grantSnapshot } from "./consent-summary.js";
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
 * - Nothing runs before consent; a missing or unreadable decision needs review and a `rejected` one
 *   is declined, whatever the content.
 * - An extension of either scope is pending again on any change of its content made outside Nerve:
 *   changed code can use every access already granted. The review lists what is new against the
 *   stored grants, and says so when the code changed with no new access.
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
    const state = this.sources
      .trust()
      .trustState(record, toTrustedDigest(contentHash));
    if (state === "trusted") return "trusted";
    const approved = record?.status === "trusted" ? record : undefined;
    // An extension row holds an extension snapshot; a row of another kind has none to compare.
    const approvedGrants = extensionGrantSnapshotSchema.safeParse(
      approved?.grants,
    ).data;
    return {
      decision: "pending",
      consent: buildConsent({
        manifest: candidate.manifest,
        contentHash,
        ...(approvedGrants ? { previous: approvedGrants } : {}),
      }),
      ...(state === "declined" ? { declined: true as const } : {}),
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
