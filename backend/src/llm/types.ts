import { z } from 'zod';

/** normalize/map run on the cheap model; edges and escalate run on the strong model. */
export type Role = 'normalize' | 'map' | 'edges' | 'escalate';

export interface Usage {inputTokens:number; outputTokens:number; cacheReadTokens:number; cacheCreationTokens:number; calls:number}
export interface UsageTotals extends Usage {byRole:Partial<Record<Role,Usage>>}
/** Receives the usage of every model call, tagged with the role that actually ran. */
export type UsageSink = (role:Role, usage:Usage) => void;

export const zeroUsage = (): Usage => ({inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,calls:0});
export const newTotals = (): UsageTotals => ({...zeroUsage(),byRole:{}});
function add(into:Usage, u:Usage) {
  into.inputTokens+=u.inputTokens; into.outputTokens+=u.outputTokens;
  into.cacheReadTokens+=u.cacheReadTokens; into.cacheCreationTokens+=u.cacheCreationTokens; into.calls+=u.calls;
}
export function recordUsage(totals:UsageTotals, role:Role, usage:Usage) {
  add(totals,usage);
  add(totals.byRole[role] ??= zeroUsage(),usage);
}

export interface AttemptRequest<T> {model:string; maxTokens:number; schema:z.ZodType<T>; prompt:string}
/** One forced-tool call. `ok:false` means the model answered but the result was invalid or truncated. */
export type Attempt<T> = {ok:true; value:T; usage:Usage} | {ok:false; reason:string; usage:Usage};

/** Vendor-shaped seam: another provider (OpenAI, Gemini) is a new class implementing this. */
export interface LlmProvider {attempt<T>(request:AttemptRequest<T>): Promise<Attempt<T>>}
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
