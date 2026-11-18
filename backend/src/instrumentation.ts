import { config } from 'dotenv';
import { resolve } from 'node:path';
import type { Instrumentation } from '@arizeai/phoenix-otel';

// This file is the first import in main.ts, so .env has to load here. main.ts reads it again later.
config({ path: resolve(__dirname, '../.env') });

// Off unless opted in. Render and the browser tests leave this unset, so they do not wait on a local collector.
if (process.env.PHOENIX_ENABLED === 'true') {
  const { register } = require('@arizeai/phoenix-otel') as typeof import('@arizeai/phoenix-otel');
  const { AnthropicInstrumentation } = require('@arizeai/openinference-instrumentation-anthropic') as typeof import('@arizeai/openinference-instrumentation-anthropic');
  const { OpenAIInstrumentation } = require('@arizeai/openinference-instrumentation-openai') as typeof import('@arizeai/openinference-instrumentation-openai');
  const instrumentations: Instrumentation[] = [new AnthropicInstrumentation(), new OpenAIInstrumentation()];
  const endpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://localhost:6006';
  register({
    projectName: process.env.PHOENIX_PROJECT_NAME || 'blindspot',
    url: endpoint,
    instrumentations,
  });
  console.info(`Phoenix tracing is on. Traces for project "blindspot" go to ${endpoint}.`);
}
