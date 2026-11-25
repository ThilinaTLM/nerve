import type { SkillReview } from "@nervekit/contracts/skills";
import { configurationAttention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import { loadSettingsSkills } from "$lib/application/settings/settings-actions.svelte";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { approvalOutcome } from "./skill-review";

export type SkillReviewPhase = "loading" | "ready" | "missing" | "error";

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** One open review page: what the user is shown, and the decision on exactly that. */
export class SkillReviewState {
  phase = $state<SkillReviewPhase>("loading");
  review = $state<SkillReview>();
  error = $state<string>();
  /** Said when the files changed under the user and the page reloaded. */
  notice = $state<string>();
  busy = $state(false);
  #request = 0;

  constructor(
    private readonly projectId: string,
    private readonly name: string,
  ) {}

  async load(): Promise<void> {
    const request = ++this.#request;
    this.phase = this.review ? this.phase : "loading";
    this.error = undefined;
    try {
      const review = await requestConversation("skill.review", {
        projectId: this.projectId,
        name: this.name,
      });
      if (request !== this.#request) return;
      this.review = review;
      this.phase = "ready";
      // The files may have changed since the bell and the counts were read.
      configurationAttention.refreshSoon();
    } catch (error) {
      if (request !== this.#request) return;
      // The review fails the same way for a missing skill and for a broken
      // connection; the project's skill list tells them apart.
      const exists = await requestConversation("skill.list", {
        projectId: this.projectId,
      })
        .then((list) =>
          list.skills.some(
            (skill) => skill.source === "project" && skill.name === this.name,
          ),
        )
        .catch(() => true);
      if (request !== this.#request) return;
      this.review = undefined;
      this.error = message(error, "Could not load the skill.");
      this.phase = exists ? "error" : "missing";
    }
  }

  /** Approves the files the user was shown; if they changed since, shows the new review instead. */
  async approve(): Promise<void> {
    await this.#decide("trusted");
  }

  /** Declines the skill, or revokes a trusted one; a decline stays whatever the files become. */
  async decline(): Promise<void> {
    await this.#decide("rejected");
  }

  async #decide(status: "trusted" | "rejected"): Promise<void> {
    const shown = this.review;
    if (!shown || this.busy) return;
    this.busy = true;
    this.error = undefined;
    this.notice = undefined;
    try {
      const current = await requestConversation("skill.review", {
        projectId: this.projectId,
        name: this.name,
      });
      if (
        status === "trusted" &&
        approvalOutcome(shown, current) === "reload"
      ) {
        this.review = current;
        this.notice =
          "The skill's files changed while you were reviewing. Review them again before trusting it.";
        return;
      }
      await requestConversation("trust.decide", {
        kind: "project_skill",
        projectId: this.projectId,
        resourceKey: current.folder,
        name: current.name,
        contentDigest: current.contentDigest,
        status,
      });
      await Promise.all([
        this.load(),
        loadSettingsSkills(this.projectId),
        configurationAttention.refresh(),
      ]);
    } catch (error) {
      this.error = message(error, "Could not save your decision.");
    } finally {
      this.busy = false;
    }
  }
}
