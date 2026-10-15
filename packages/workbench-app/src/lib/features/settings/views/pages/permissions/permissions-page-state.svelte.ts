import type {
  PermissionPolicyConfiguration,
  PermissionRule,
} from "@nervekit/contracts/permissions";
import {
  deletePermissionRule,
  getPermissionConfiguration,
  grantProjectPermissionTrust,
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
