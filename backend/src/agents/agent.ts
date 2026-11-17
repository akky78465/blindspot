import { z } from 'zod';

export interface Model {
  structured<T>(schema: z.ZodType<T>, prompt: string, opts?: { system?: string }): Promise<T>;
  // Checked before a background job starts, so a missing key returns 503 and does not lock the session.
  assertConfigured?(): void;
}

export interface Agent<In, Out> {
  name: 'normalizer' | 'feature-mapper' | 'edge-case';
  output: z.ZodType<Out>;
  instructions: string;
  buildInput(input: In): string;
}

// The joined string must stay byte-identical to the current prompt functions.
export function compose<In, Out>(agent: Agent<In, Out>, input: In) {
  return agent.instructions + '\n' + agent.buildInput(input);
}
