import { BadGatewayException, Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { AnthropicProvider } from './anthropic';
import { LLM_PROVIDER, LlmProvider, Role, UsageSink } from './types';

const MAX_TOKENS:Record<Role,number> = {normalize:8000,map:8000,edges:6000,escalate:12000};
const correction = (reason:string) => `\nPrevious response was invalid. Fix these validation errors and return the complete result: ${reason}`;

/** Model ids per role. Read at call time so env changes (and tests) take effect immediately. */
export function modelFor(role:Role): string {
  const strong = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  switch (role) {
    case 'normalize': return process.env.LLM_NORMALIZE || 'claude-haiku-5-5';
    case 'map': return process.env.LLM_MAP || 'claude-haiku-5-5';
    case 'edges': return process.env.LLM_EDGES || strong;
    case 'escalate': return process.env.LLM_ESCALATE || strong;
  }
}

@Injectable()
export class LlmRouter {
  private readonly provider:LlmProvider;
  constructor(@Optional() @Inject(LLM_PROVIDER) provider?:LlmProvider) {this.provider = provider ?? new AnthropicProvider();}

  /**
   * Cheap roles (normalize, map): try the cheap model, retry it once with the validation error,
   * then make a single call on the strong model. Strong roles: one call plus one repair retry.
   */
  async structured<T>(role:Role, schema:z.ZodType<T>, prompt:string, sink?:UsageSink): Promise<T> {
    const run = async (as:Role, text:string) => {
      const result = await this.provider.attempt({model:modelFor(as),maxTokens:MAX_TOKENS[as],schema,prompt:text});
      sink?.(as,result.usage);
      return result;
    };
    const cheap = role === 'normalize' || role === 'map';
    let reason = '';
    if (cheap) {
      for (let i=0; i<2; i++) {
        let result;
        try {result = await run(role, i ? prompt+correction(reason) : prompt);}
        catch {break;} // cheap model unavailable or erroring: go straight to the strong model
        if (result.ok) return result.value;
        reason = result.reason;
      }
      const result = await run('escalate', reason ? prompt+correction(reason) : prompt);
      if (result.ok) return result.value;
      throw new BadGatewayException('Claude returned invalid or truncated structured data after escalation. Try a smaller upload.');
    }
    for (let i=0; i<2; i++) {
      const result = await run(role, i ? prompt+correction(reason) : prompt);
      if (result.ok) return result.value;
      reason = result.reason;
    }
    throw new BadGatewayException('Claude returned invalid or truncated structured data twice. Try a smaller upload.');
  }
}
