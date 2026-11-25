import type {
  PermissionPolicyConfiguration,
  PermissionRule,
} from "@nervekit/contracts/permissions";
import {
  deletePermissionRule,
  getPermissionConfiguration,
  declineProjectPermissionTrust,
  grantProjectPermissionTrust,
  projectPermissionTrustKey,
  savePermissionRule,
  type PermissionRuleTarget,
} from "$lib/features/settings/api/permissions.api";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Permission settings request failed.";
}

/** Loads and mutates permission overlays; the server returns the refreshed configuration. */
export class PermissionsPageController {
  configuration = $state<PermissionPolicyConfiguration>();
  loading = $state(false);
  error = $state<string>();
  #generation = 0;
  #projectId?: string;

  /** Loads for a project (or user-only data when none is active). */
  async load(projectId: string | undefined): Promise<void> {
    if (projectId !== this.#projectId) this.configuration = undefined;
    this.#projectId = projectId;
    const generation = ++this.#generation;
    this.loading = true;
    this.error = undefined;
    try {
      const configuration = await getPermissionConfiguration(projectId);
      if (generation === this.#generation) this.configuration = configuration;
    } catch (error) {
      if (generation === this.#generation) this.error = messageOf(error);
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }

  /** Resolves with an error message so a dialog can keep its draft; undefined on success. */
  async saveRule(
    target: PermissionRuleTarget,
    rule: PermissionRule,
    previousRuleId?: string,
  ): Promise<string | undefined> {
    return this.#mutate(() => savePermissionRule(target, rule, previousRuleId));
  }

  async deleteRule(
    target: PermissionRuleTarget,
    ruleId: string,
  ): Promise<string | undefined> {
    return this.#mutate(() => deletePermissionRule(target, ruleId));
  }

  async trustProject(projectId: string): Promise<string | undefined> {
    return this.#mutate(() => grantProjectPermissionTrust(projectId));
  }

  /**
   * Declines the project's permissions file, or revokes a trusted one. The
   * decision is keyed by the file's path as the daemon names it: the existing
   * decision's key, else the path the configuration report gives.
   */
  async declineProject(
    projectId: string,
    reportedPath: string | undefined,
  ): Promise<string | undefined> {
    const digest = this.configuration?.projectTrust.digest;
    if (!digest?.startsWith("sha256:"))
      return "The project's permissions file can't be read. Reload and try again.";
    let path: string | undefined;
    try {
      path = (await projectPermissionTrustKey(projectId)) ?? reportedPath;
    } catch (error) {
      return messageOf(error);
    }
    if (!path)
      return "The project's permissions file is not known yet. Reload and try again.";
    return this.#mutate(() =>
      declineProjectPermissionTrust(projectId, path, digest),
    );
  }

  async #mutate(
    run: () => Promise<PermissionPolicyConfiguration>,
  ): Promise<string | undefined> {
    try {
      const configuration = await run();
      ++this.#generation;
      this.configuration = configuration;
      this.loading = false;
      this.error = undefined;
      return undefined;
    } catch (error) {
      return messageOf(error);
    }
  }
}
