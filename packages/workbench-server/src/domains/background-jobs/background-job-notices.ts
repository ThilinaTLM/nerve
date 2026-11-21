import type { ActivityService } from "../activity/activity.service.js";
import {
  BACKGROUND_JOB_NOTICE_AFTER_FAILURES,
  type BackgroundJobDefinition,
} from "./background-jobs.service.js";

const BACKGROUND_JOBS_SETTINGS_PAGE = "background-jobs";

type NoticePort = Pick<ActivityService, "reportNotice" | "removeNotice">;

/**
 * Producer-owned bell notices for jobs. Routine runs stay out of the bell: a
 * job reports only what the user must act on, and clears it once resolved.
 */
export class BackgroundJobNotices {
  constructor(private readonly activities: NoticePort) {}

  /** A notice owned by `jobId`; `key` names one problem (an account id), `settingsPage` is where the user fixes it. */
  report(
    jobId: string,
    key: string,
    notice: { title: string; message?: string; settingsPage?: string },
  ): void {
    this.activities.reportNotice({
      id: noticeId(jobId, key),
      kind: `background-job.${jobId}`,
      title: notice.title,
      message: notice.message,
      settingsPage: notice.settingsPage ?? BACKGROUND_JOBS_SETTINGS_PAGE,
    });
  }

  clear(jobId: string, key: string): void {
    this.activities.removeNotice(noticeId(jobId, key));
  }

  /** The scheduler's outcome hook: a notice after repeated failures, cleared on the next success. */
  jobOutcome = (
    job: BackgroundJobDefinition,
    failures: number,
    error?: string,
  ): void => {
    if (failures >= BACKGROUND_JOB_NOTICE_AFTER_FAILURES)
      this.report(job.id, "failing", {
        title: `${job.label} keeps failing`,
        message: error,
      });
    else if (failures === 0) this.clear(job.id, "failing");
  };
}

function noticeId(jobId: string, key: string): string {
  return `activity_background_job_${jobId}_${key}`;
}
