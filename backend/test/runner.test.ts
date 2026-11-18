import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {Model} from '../src/agents/agent';
import {edgeCase} from '../src/agents/edge-case';
import {REVIEW_START} from '../src/agents/judge';
import {EdgeRunner} from '../src/agents/runner';
import {OpenAiJudge} from '../src/openai';
import {Suggestion} from '../src/schemas';
import {Sessions} from '../src/sessions';
import {ClaudeClient} from '../src/claude';
import {map} from './fixtures';

function suggestion(title:string):Suggestion{return {id:'llm',featureId:'wrong',title,category:'null_empty',priority:'high',rationale:'gap',preconditions:[],steps:['Submit'],dataSpec:[],expectedResult:'Shown'};}
function scripted(replies:unknown[]):Model & {prompts:string[]}{const prompts:string[]=[];let index=0;return {prompts,async structured<T>(schema:z.ZodType<T>,prompt:string){prompts.push(prompt);return schema.parse(replies[index++]);}};}
const input={feature:map.features[0],cases:[{id:'TC-001',title:'Login',preconditions:[],steps:[],inputs:[],type:'positive' as const,sourceRef:'row 2',expectedResult:'Success'}]};

test('a rejection is sent back once and the corrected draft is kept',async()=>{
  const generator=scripted([{suggestions:[suggestion('Old')]},{suggestions:[suggestion('New')]}]);
  const judge=scripted([{accept:false,issues:[{title:'Old',problem:'Too vague.'}]},{accept:true,issues:[]}]);
  const result=await new EdgeRunner(generator,judge).run(edgeCase,input);
  assert.equal(result.suggestions[0].title,'New');
  assert.match(result.review,/OpenAI rejected 1 item/);
  assert.match(result.review,/OpenAI second review accepted the rewrite/);
  assert.equal(generator.prompts.length,2);
  assert.ok(generator.prompts[1].includes('Revise the previous draft'));
  assert.ok(generator.prompts[1].includes(REVIEW_START));
  assert.ok(generator.prompts[1].includes('Too vague.'));
  assert.ok(generator.prompts[1].includes('Previous draft JSON'));
  assert.ok(generator.prompts[1].includes('Old'));
  assert.ok(generator.prompts[1].includes('Omit params on empty'));
  assert.ok(generator.prompts[0].includes('omit params'));
  assert.ok(generator.prompts[0].includes('strictly positive'));
  assert.ok(generator.prompts[1].includes('When steps name a currency'));
});

test('a second rejection drops only the named suggestion',async()=>{
  const draft={suggestions:[suggestion('Keep me'),suggestion('Drop me')]};
  const generator=scripted([draft,draft]);
  const judge=scripted([{accept:false,issues:[{title:'Drop me',problem:'Already covered.'}]},{accept:false,issues:[{title:'Drop me',problem:'Already covered.'}]}]);
  const result=await new EdgeRunner(generator,judge).run(edgeCase,input);
  assert.deepEqual(result.suggestions.map(item=>item.title),['Keep me']);
  assert.match(result.notes[0],/Drop me/);
});

test('a second rejection drops a suggestion named by id in the problem',async()=>{
  const keep=suggestion('Keep me');
  const drop={...suggestion('Bad email max'),id:'TC-009'};
  const draft={suggestions:[keep,drop]};
  const generator=scripted([draft,draft]);
  const judge=scripted([{accept:false,issues:[{title:'Invented email maximum',problem:'TC-009 assumes a 254-character maximum.'}]},{accept:false,issues:[{title:'Invented email maximum',problem:'TC-009 assumes a 254-character maximum.'}]}]);
  const result=await new EdgeRunner(generator,judge).run(edgeCase,input);
  assert.deepEqual(result.suggestions.map(item=>item.title),['Keep me']);
});

test('beginEdges reports a missing OpenAI key before the session is busy',()=>{
  const saved={openai:process.env.OPENAI_API_KEY,anthropic:process.env.ANTHROPIC_API_KEY};
  delete process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY=saved.anthropic || 'test-only';
  try{
    const runner=new EdgeRunner(new ClaudeClient(),new OpenAiJudge());
    const sessions=new Sessions(new ClaudeClient(),runner);
    sessions.sessions.set('demo',{testCases:[],suggestions:[],busy:false,created:Date.now(),featureMap:map,progress:{completed:0,total:0,current:'',status:'idle',error:'',review:''}});
    assert.throws(()=>sessions.beginEdges('demo'),/OPENAI_API_KEY/);
    assert.equal(sessions.get('demo').busy,false);
  }finally{
    if(saved.openai===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=saved.openai;
    if(saved.anthropic===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=saved.anthropic;
  }
});
