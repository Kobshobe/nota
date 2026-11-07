import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createModels, type Api, type Model } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { AppConfig } from '../config';

export interface AgentRuntime {
  model: Model<Api>;
  streamFn: StreamFn;
  apiKey?: string;
}

export function createDeepSeekRuntime(config: AppConfig): AgentRuntime {
  const models = createModels();
  models.setProvider(deepseekProvider());
  const found = models.getModel('deepseek', config.deepseekModel);
  if (!found) {
    throw new Error(`Unknown DeepSeek model: ${config.deepseekModel}`);
  }
  const model: Model<Api> = { ...found, baseUrl: config.deepseekBaseUrl };
  return {
    model,
    streamFn: models.streamSimple.bind(models) as StreamFn,
    apiKey: config.deepseekApiKey,
  };
}
