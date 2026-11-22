import type { BackgroundJob } from "@nervekit/contracts/background-jobs";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export async function listBackgroundJobs(): Promise<BackgroundJob[]> {
  return (await requestWorkbench("backgroundJobs.list", {})).jobs;
}

export async function runBackgroundJobNow(
  jobId: string,
): Promise<BackgroundJob> {
  return (await requestWorkbench("backgroundJobs.runNow", { jobId })).job;
}
