import {
  ConverseCommand,
  type BedrockRuntimeClient,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { FinaleBatchEnv } from "./env";

export type ResolvedBedrockConfig = {
  region: string;
  configuredModelId: string;
  invocationModelId: string;
  inferenceProfileId: string | null;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function isInferenceProfileIdentifier(modelId: string): boolean {
  return modelId.startsWith("arn:") || /^(us|eu|apac|global)\./.test(modelId);
}

export function deriveGeoInferenceProfileId(region: string, modelId: string): string | null {
  const normalizedRegion = normalizeWhitespace(region).toLowerCase();
  const normalizedModelId = normalizeWhitespace(modelId);
  if (!normalizedRegion || !normalizedModelId || isInferenceProfileIdentifier(normalizedModelId)) {
    return null;
  }

  if (normalizedRegion.startsWith("us-")) {
    return `us.${normalizedModelId}`;
  }
  if (normalizedRegion.startsWith("eu-")) {
    return `eu.${normalizedModelId}`;
  }
  if (normalizedRegion.startsWith("ap-")) {
    return `apac.${normalizedModelId}`;
  }
  return null;
}

function isInferenceProfileRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /on-demand throughput isn.t supported/i.test(message) ||
    /retry your request with the id or arn of an inference profile/i.test(message)
  );
}

export function resolveBedrockConfig(env: FinaleBatchEnv): ResolvedBedrockConfig {
  const region = normalizeWhitespace(env.BEDROCK_REGION);
  const configuredModelId = normalizeWhitespace(env.BEDROCK_MODEL_ID);
  const inferenceProfileId = normalizeWhitespace(env.BEDROCK_INFERENCE_PROFILE_ID);
  if (!region) {
    throw new Error("CODE_LLM_ENABLED=true requires BEDROCK_REGION when LLM_PROVIDER=bedrock.");
  }
  if (!configuredModelId) {
    throw new Error("CODE_LLM_ENABLED=true requires BEDROCK_MODEL_ID when LLM_PROVIDER=bedrock.");
  }

  return {
    region,
    configuredModelId,
    invocationModelId: inferenceProfileId || configuredModelId,
    inferenceProfileId: inferenceProfileId || null,
  };
}

export async function sendBedrockConverseWithProfileFallback(input: {
  client: BedrockRuntimeClient;
  config: ResolvedBedrockConfig;
  command: Omit<ConverseCommandInput, "modelId">;
}): Promise<{
  response: ConverseCommandOutput;
  invocationModelId: string;
  autoResolvedInferenceProfile: boolean;
}> {
  try {
    const response = await input.client.send(new ConverseCommand({
      ...input.command,
      modelId: input.config.invocationModelId,
    }));
    return {
      response,
      invocationModelId: input.config.invocationModelId,
      autoResolvedInferenceProfile: false,
    };
  } catch (error) {
    const derivedInferenceProfileId =
      input.config.inferenceProfileId === null
        ? deriveGeoInferenceProfileId(input.config.region, input.config.configuredModelId)
        : null;

    if (
      !derivedInferenceProfileId ||
      derivedInferenceProfileId === input.config.invocationModelId ||
      !isInferenceProfileRetryableError(error)
    ) {
      throw error;
    }

    const response = await input.client.send(new ConverseCommand({
      ...input.command,
      modelId: derivedInferenceProfileId,
    }));
    return {
      response,
      invocationModelId: derivedInferenceProfileId,
      autoResolvedInferenceProfile: true,
    };
  }
}
