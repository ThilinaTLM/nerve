import step0001 from "./0001-nerve-home-v1/step.js";
import step0002 from "./0002-atomic-run-lifecycle-work/step.js";
import step0003 from "./0003-authoritative-run-lifecycle/step.js";
import step0004 from "./0004-convert-run-lifecycle/step.js";
import step0005 from "./0005-async-subagent-completions/step.js";
import step0006 from "./0006-explore-agent-names/step.js";
import step0007 from "./0007-agent-async-obligations/step.js";
import step0008 from "./0008-tool-result-payload-reference/step.js";
import step0009 from "./0009-agent-async-obligations-backfill/step.js";
import step0010 from "./0010-deletion-indexes/step.js";
import type { MigrationStepV1 } from "../kit/define-step/v1.js";

/** Append-only canonical order. The runner must reject duplicate or non-contiguous ordinals. */
export const STORAGE_MIGRATION_STEPS: readonly MigrationStepV1[] =
  Object.freeze([
    step0001,
    step0002,
    step0003,
    step0004,
    step0005,
    step0006,
    step0007,
    step0008,
    step0009,
    step0010,
  ]);
