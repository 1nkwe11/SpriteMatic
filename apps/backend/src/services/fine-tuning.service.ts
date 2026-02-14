import OpenAI from "openai";
import { env } from "../config/env.js";

const parseWandbTags = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 20);

export const buildFineTuneWandbIntegrations = ({
  runName
}: {
  runName?: string;
} = {}): OpenAI.FineTuning.JobCreateParams.Integration[] | undefined => {
  if (!env.OPENAI_FINE_TUNE_WANDB_PROJECT) {
    return undefined;
  }

  const tags = parseWandbTags(env.OPENAI_FINE_TUNE_WANDB_TAGS);

  return [
    {
      type: "wandb",
      wandb: {
        project: env.OPENAI_FINE_TUNE_WANDB_PROJECT,
        ...(env.OPENAI_FINE_TUNE_WANDB_ENTITY ? { entity: env.OPENAI_FINE_TUNE_WANDB_ENTITY } : {}),
        ...(runName ? { name: runName } : {}),
        ...(tags.length > 0 ? { tags } : {})
      }
    }
  ];
};

export const withFineTuneWandbIntegration = ({
  params,
  runName
}: {
  params: OpenAI.FineTuning.JobCreateParams;
  runName?: string;
}): OpenAI.FineTuning.JobCreateParams => {
  const integrations = buildFineTuneWandbIntegrations({ runName });
  if (!integrations) {
    return params;
  }

  return {
    ...params,
    integrations
  };
};
