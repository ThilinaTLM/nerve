import assert from "node:assert/strict";
import { sha256 } from "./released-format.js";
import profiles from "./converted-mode-profiles.json" with { type: "json" };

// Frozen #473 storage target. Do not import evolving request/resolution contracts.
type ObjectValue = Record<string, unknown>;
interface HistoricalTarget {
  name: string;
  digest: string;
}
export interface HistoricalReviewRequest extends ObjectValue {
  targetProfile: HistoricalTarget;
  expectedRevision: number;
  expectedDigest: string;
}
export function objectValue(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}
function targetProfile(name: unknown): HistoricalTarget {
  assert(
    typeof name === "string" &&
      name.length <= 32 &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name),
    "Invalid historical approval profile",
  );
  const bytes = Object.hasOwn(profiles, name)
    ? (profiles as Record<string, string>)[name]
    : undefined;
  return {
    name,
    // Released reviews used coding. For an authored legacy name whose original
    // definition was not captured, use an explicitly archival identity, NOT the
    // bytes of a possibly changed project profile. Home migration never reads it.
    digest: sha256(bytes ?? `historical-plan-review-profile:${name}`),
  };
}
/** Legacy reviews did not capture CAS/transition evidence. These stable archival
 * bindings make history readable without pretending to authorize a live switch.
 * A migration-prefixed transition ID can never match a live transition capture. */
export function historicalReviewRequest(
  value: ObjectValue,
  toolCallId: string,
): HistoricalReviewRequest {
  const result = structuredClone(value);
  const target = objectValue(result.targetProfile);
  if (Object.hasOwn(result, "targetProfile")) {
    assert(
      target &&
        typeof target.name === "string" &&
        typeof target.digest === "string" &&
        /^[a-f0-9]{64}$/.test(target.digest),
      "Invalid historical profile target",
    );
  } else
    result.targetProfile = targetProfile(
      result.approvalProfile === undefined ? "coding" : result.approvalProfile,
    );
  delete result.approvalProfile;
  if (!Object.hasOwn(result, "expectedRevision")) result.expectedRevision = 0;
  if (!Object.hasOwn(result, "expectedDigest"))
    result.expectedDigest = sha256(
      `historical-plan-review-source:${toolCallId}`,
    );
  assert(
    typeof result.expectedRevision === "number" &&
      Number.isSafeInteger(result.expectedRevision) &&
      result.expectedRevision >= 0,
    "Invalid historical review revision",
  );
  assert(
    typeof result.expectedDigest === "string" &&
      (result.expectedDigest === "missing" ||
        /^[a-f0-9]{64}$/.test(result.expectedDigest)),
    "Invalid historical review digest",
  );
  return result as HistoricalReviewRequest;
}
export function historicalReviewConfirmation(
  resolution: ObjectValue,
  request: HistoricalReviewRequest,
  toolCallId: string,
): boolean {
  if (
    resolution.kind !== "plan_review" ||
    resolution.decision !== "approve" ||
    Object.hasOwn(resolution, "confirmation")
  )
    return false;
  resolution.confirmation = {
    targetProfile: request.targetProfile,
    expectedRevision: request.expectedRevision,
    expectedDigest: request.expectedDigest,
    transitionId: `migration:0002-plan-review:${toolCallId}`,
  };
  return true;
}
