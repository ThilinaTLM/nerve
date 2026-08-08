export type SetupProgressInput = {
  providerReady: boolean;
  voiceReady: boolean;
  scopedModelsValid: boolean;
  agentDefaultsReady: boolean;
  productTourCompleted: boolean;
};

export type SetupProgress = { ready: number; total: 5 };

export function calculateSetupProgress(
  input: SetupProgressInput,
): SetupProgress {
  return {
    ready:
      Number(input.providerReady) +
      Number(input.voiceReady) +
      Number(input.scopedModelsValid) +
      Number(input.agentDefaultsReady) +
      Number(input.productTourCompleted),
    total: 5,
  };
}
