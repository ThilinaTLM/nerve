import type {
  RepairApplyRequest,
  RepairApplyResult,
  RepairPreview,
  RepairPreviewRequest,
  RepairPreviewResult,
} from "@nervekit/contracts/agent-configuration";
export type RepairState = {
  busy: boolean;
  preview?: RepairPreview;
  result?: Extract<RepairApplyResult, { status: "saved" }>;
  error?: string;
};
/** Keeps a failed apply's exact confirmation for receipt reconciliation. Preview/dismiss never write. */
export class ConfigurationRepair {
  state: RepairState = { busy: false };
  private confirmation?: RepairApplyRequest;
  private generation = 0;
  private applying = false;
  constructor(
    private readonly requests: {
      preview: (request: RepairPreviewRequest) => Promise<RepairPreviewResult>;
      apply: (request: RepairApplyRequest) => Promise<RepairApplyResult>;
    },
    private readonly changed: (state: RepairState) => void,
  ) {}
  private publish(state: RepairState) {
    this.state = state;
    this.changed(state);
  }
  dismiss() {
    if (this.applying) return;
    this.generation++;
    this.confirmation = undefined;
    this.publish({ busy: false });
  }
  edited() {
    this.dismiss();
  }
  async preview(request: RepairPreviewRequest) {
    if (this.state.busy) return;
    const generation = ++this.generation;
    this.confirmation = undefined;
    this.publish({ busy: true });
    try {
      const result = await this.requests.preview(request);
      if (generation !== this.generation) return;
      if (result.status !== "ready") {
        this.publish({
          busy: false,
          error: `Repair preview ${result.status}. Review the source and replacement.`,
        });
        return;
      }
      const {
        target,
        sourceDigest,
        candidateDigest,
        candidateVersion,
        candidate,
        targetProfile,
      } = result.preview;
      this.confirmation = {
        target,
        sourceDigest,
        candidateDigest,
        candidateVersion,
        candidate,
        ...(targetProfile ? { targetProfile } : {}),
      };
      this.publish({ busy: false, preview: result.preview });
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  async apply(): Promise<boolean> {
    if (this.state.busy || !this.confirmation || this.state.result)
      return false;
    this.applying = true;
    const preview = this.state.preview;
    this.publish({ busy: true, preview });
    try {
      const result = await this.requests.apply(this.confirmation);
      if (result.status === "saved") {
        this.applying = false;
        this.publish({ busy: false, preview, result });
        return true;
      }
      this.confirmation = undefined;
      this.publish({
        busy: false,
        error: `Repair ${result.status}. Preview again before confirming.`,
      });
    } catch (error) {
      this.publish({
        busy: false,
        preview,
        error: `${error instanceof Error ? error.message : String(error)}. Retry this confirmation to reconcile a committed receipt, or preview again.`,
      });
    }
    this.applying = false;
    return false;
  }
}
