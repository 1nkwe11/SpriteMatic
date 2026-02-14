export type ModelRateProfile = {
  inputPerMTokens: number;
  outputPerMTokens: number;
  maxAttempts: number;
  displayName: string;
};

export const MODEL_RATES: Record<string, ModelRateProfile> = {
  "gpt-4.1": {
    displayName: "GPT-4.1",
    inputPerMTokens: 2.0,
    outputPerMTokens: 8.0,
    maxAttempts: 4
  },
  "gpt-4.1-mini": {
    displayName: "GPT-4.1-mini",
    inputPerMTokens: 0.4,
    outputPerMTokens: 1.6,
    maxAttempts: 3
  },
  "gpt-4.1-nano": {
    displayName: "GPT-4.1-nano",
    inputPerMTokens: 0.1,
    outputPerMTokens: 0.4,
    maxAttempts: 2
  },
  "gpt-4o": {
    displayName: "GPT-4o",
    inputPerMTokens: 2.5,
    outputPerMTokens: 10.0,
    maxAttempts: 3
  },
  "gpt-4o-mini": {
    displayName: "GPT-4o-mini",
    inputPerMTokens: 0.15,
    outputPerMTokens: 0.6,
    maxAttempts: 2
  },
  "gpt-image-1": {
    displayName: "GPT-Image-1",
    inputPerMTokens: 0.4,
    outputPerMTokens: 0,
    maxAttempts: 3
  }
};

export const formatModelLabelWithCost = (model: string) => {
  const profile = MODEL_RATES[model];
  const name = profile?.displayName ?? model;

  if (!profile) {
    return name;
  }

  return `${name} (${profile.inputPerMTokens.toFixed(2)}/${profile.outputPerMTokens.toFixed(2)} per 1M tokens)`;
};
