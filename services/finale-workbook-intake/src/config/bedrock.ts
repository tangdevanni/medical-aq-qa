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
  converseTimeoutMs: number;
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
    converseTimeoutMs: env.BEDROCK_CONVERSE_TIMEOUT_MS,
  };
}

async function sendConverseWithTimeout(input: {
  client: BedrockRuntimeClient;
  command: Omit<ConverseCommandInput, "modelId">;
  modelId: string;
  timeoutMs: number;
}): Promise<ConverseCommandOutput> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, input.timeoutMs);

  try {
    return await input.client.send(new ConverseCommand({
      ...input.command,
      modelId: input.modelId,
    }), {
      abortSignal: abortController.signal,
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(`Bedrock Converse timed out after ${input.timeoutMs}ms for model ${input.modelId}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    const response = await sendConverseWithTimeout({
      client: input.client,
      command: input.command,
      modelId: input.config.invocationModelId,
      timeoutMs: input.config.converseTimeoutMs,
    });
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

    const response = await sendConverseWithTimeout({
      client: input.client,
      command: input.command,
      modelId: derivedInferenceProfileId,
      timeoutMs: input.config.converseTimeoutMs,
    });
    return {
      response,
      invocationModelId: derivedInferenceProfileId,
      autoResolvedInferenceProfile: true,
    };
  }
}
