import { runCancellationScenarios } from "./cancellation.js";
import { runCompletionScenario } from "./completion.js";
import type {
  RealHostRunMatrixFixture,
  RealHostRunMatrixResult,
} from "./fixture.js";
import { runInteractionScenarios } from "./interactions.js";
import { runRedeliveryRaceScenarios } from "./redelivery-races.js";
import { runRetryRecoveryScenarios } from "./retry-recovery.js";
import { runToolLifecycleScenario } from "./tools.js";

/** Runs the production-host parity matrix in deterministic provider order. */
export async function runRealHostParityMatrix(
  fixture: RealHostRunMatrixFixture,
): Promise<RealHostRunMatrixResult> {
  const scenarios = [];
  scenarios.push(await runCompletionScenario(fixture));
  scenarios.push(await runToolLifecycleScenario(fixture));
  scenarios.push(await runInteractionScenarios(fixture));
  scenarios.push(await runCancellationScenarios(fixture));
  scenarios.push(await runRetryRecoveryScenarios(fixture));
  scenarios.push(await runRedeliveryRaceScenarios(fixture));
  return {
    scenarios,
    totalRuns: scenarios.reduce((sum, scenario) => sum + scenario.runs, 0),
    totalAssertions: scenarios.reduce(
      (sum, scenario) => sum + scenario.assertions,
      0,
    ),
  };
}
