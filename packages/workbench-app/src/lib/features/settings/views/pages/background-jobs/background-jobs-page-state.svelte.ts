import type { BackgroundJob } from "@nervekit/contracts/background-jobs";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { ControllerLifecycle } from "$lib/platform/lifecycle/controller-lifecycle";
import {
  listBackgroundJobs,
  runBackgroundJobNow,
} from "$lib/features/settings/api/background-jobs.api";

/** Jobs are live in the daemon; the list is a snapshot kept current by `backgroundJobs.changed`. */
export class BackgroundJobsPageController {
  jobs = $state.raw<BackgroundJob[]>([]);
  loading = $state(true);
  errorMessage = $state<string | undefined>();
  #life = new ControllerLifecycle();

  start(): void {
    this.#life.restart((scope) => {
      scope.onDispose(
        onEvent("backgroundJobs.changed", (event) => {
          const job = (event.data as { job?: BackgroundJob }).job;
          if (!job) return;
          this.jobs = this.jobs.some((item) => item.id === job.id)
            ? this.jobs.map((item) => (item.id === job.id ? job : item))
            : [...this.jobs, job];
        }),
      );
      void this.#load();
    });
  }
  dispose(): void {
    this.#life.dispose();
  }
  async runNow(jobId: string): Promise<void> {
    this.errorMessage = undefined;
    try {
      const job = await runBackgroundJobNow(jobId);
      this.jobs = this.jobs.map((item) => (item.id === job.id ? job : item));
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : "Could not start the job.";
    }
  }
  async #load(): Promise<void> {
    const isCurrent = this.#life.capture();
    try {
      const jobs = await listBackgroundJobs();
      if (isCurrent()) this.jobs = jobs;
    } catch (error) {
      if (isCurrent())
        this.errorMessage =
          error instanceof Error ? error.message : "Could not load jobs.";
    } finally {
      if (isCurrent()) this.loading = false;
    }
  }
}
