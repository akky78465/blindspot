import { Inject, Injectable, Logger } from '@nestjs/common';
import { Suggestion } from '../schemas';
import { Agent, compose, Model } from './agent';
import { EdgeInput } from './edge-case';
import { judgeUserPrompt, JUDGE_SYSTEM, reviewBlock, verdictSchema } from './judge';

export const EDGE_GENERATOR = 'EDGE_GENERATOR';
export const EDGE_JUDGE = 'EDGE_JUDGE';

export interface EdgeRun { suggestions: Suggestion[]; notes: string[]; review: string }

@Injectable()
export class EdgeRunner {
  private readonly log = new Logger(EdgeRunner.name);
  constructor(
    @Inject(EDGE_GENERATOR) private readonly generator: Model,
    @Inject(EDGE_JUDGE) private readonly judge: Model,
  ) {}

  prepare() {
    this.generator.assertConfigured?.();
    this.judge.assertConfigured?.();
  }

  async run(agent: Agent<EdgeInput, { suggestions: Suggestion[] }>, input: EdgeInput): Promise<EdgeRun> {
    const prompt = compose(agent, input);
    let draft = await this.generator.structured(agent.output, prompt);
    const review: string[] = [];
    let verdict = await this.judge.structured(verdictSchema, judgeUserPrompt(agent.instructions, agent.buildInput(input), draft), { system: JUDGE_SYSTEM });
    const first = `${input.feature.name}: OpenAI ${verdict.accept ? 'accepted the draft' : `rejected ${verdict.issues.length} item(s); sending them back to Claude`}`;
    review.push(first);
    this.log.log(first);
    if (!verdict.accept) {
      draft = await this.generator.structured(agent.output, prompt + reviewBlock(verdict.issues, draft));
      verdict = await this.judge.structured(verdictSchema, judgeUserPrompt(agent.instructions, agent.buildInput(input), draft), { system: JUDGE_SYSTEM });
      const second = `${input.feature.name}: OpenAI second review ${verdict.accept ? 'accepted the rewrite' : `still rejected ${verdict.issues.length} item(s)`}`;
      review.push(second);
      this.log.log(second);
    }
    if (verdict.accept) return { suggestions: draft.suggestions, notes: [], review: review.join('\n') };
    // A second rejection filters by title and does not throw. A transport or schema error still throws above.
    const named = new Set(verdict.issues.map(issue => issue.title.trim()));
    return {
      suggestions: draft.suggestions.filter(suggestion => !named.has(suggestion.title.trim())),
      notes: verdict.issues.map(issue => `Dropped "${issue.title.trim()}": ${issue.problem}`),
      review: review.join('\n'),
    };
  }
}
