import { Inject, Injectable, Logger } from '@nestjs/common';
import { Suggestion } from '../schemas';
import { Agent, compose, Model } from './agent';
import { EdgeInput } from './edge-case';
import { judgeUserPrompt, JUDGE_SYSTEM, reviewBlock, verdictSchema } from './judge';

export const EDGE_GENERATOR = 'EDGE_GENERATOR';
export const EDGE_JUDGE = 'EDGE_JUDGE';

export interface EdgeRun { suggestions: Suggestion[]; notes: string[]; review: string }

function cites(issue: { title: string; problem: string }, suggestion: Suggestion) {
  const title = issue.title.trim();
  if (title === suggestion.title.trim() || title === suggestion.id.trim()) return true;
  const id = suggestion.id.trim();
  if (!id) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`).test(`${issue.title}\n${issue.problem}`);
}

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
    // A second rejection removes the named suggestion and does not throw. A transport or schema error still throws above.
    return {
      suggestions: draft.suggestions.filter(suggestion => !verdict.issues.some(issue => cites(issue, suggestion))),
      notes: verdict.issues.map(issue => `Dropped "${issue.title.trim()}": ${issue.problem}`),
      review: review.join('\n'),
    };
  }
}
