import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {LlmRouter} from '../src/llm/router';
import {AnthropicProvider} from '../src/llm/anthropic';
import {Attempt,AttemptRequest,LlmProvider,Role,zeroUsage} from '../src/llm/types';

function env(vars:Record<string,string|undefined>){
  const saved:Record<string,string|undefined>={};
  for(const k of Object.keys(vars)){saved[k]=process.env[k];if(vars[k]===undefined)delete process.env[k];else process.env[k]=vars[k];}
  return()=>{for(const k of Object.keys(saved)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}};
}
const schema=z.object({count:z.number()});
function scripted(answers:(Attempt<unknown>|Error)[]){
  const calls:{model:string;prompt:string;maxTokens:number}[]=[];
  const provider:LlmProvider={async attempt<T>(r:AttemptRequest<T>){calls.push({model:r.model,prompt:r.prompt,maxTokens:r.maxTokens});const a=answers.shift()!;if(a instanceof Error)throw a;return a as Attempt<T>;}};
  return{calls,router:new LlmRouter(provider)};
}
const ok=(count:number):Attempt<unknown>=>({ok:true,value:{count},usage:{...zeroUsage(),calls:1}});
const bad:Attempt<unknown>={ok:false,reason:'count: expected number',usage:{...zeroUsage(),calls:1}};

test('map failures retry on the cheap model once, then escalate to the strong model with the error',async()=>{
  const restore=env({LLM_MAP:'cheap-m',LLM_ESCALATE:'strong-m',CLAUDE_MODEL:undefined});
  try{
    const {calls,router}=scripted([bad,bad,ok(7)]);const seen:Role[]=[];
    const value=await router.structured('map',schema,'PROMPT',r=>seen.push(r));
    assert.equal(value.count,7);
    assert.deepEqual(calls.map(c=>c.model),['cheap-m','cheap-m','strong-m']);
    assert.ok(!calls[0].prompt.includes('Previous response was invalid'));
    assert.match(calls[1].prompt,/Previous response was invalid.*count: expected number/s);
    assert.match(calls[2].prompt,/^PROMPT[\s\S]*count: expected number/);
    assert.deepEqual(seen,['map','map','escalate']);
  }finally{restore();}
});

test('cheap success makes one cheap call; cheap API failure goes straight to the strong model',async()=>{
  const restore=env({LLM_NORMALIZE:'cheap-m',LLM_ESCALATE:'strong-m'});
  try{
    const a=scripted([ok(1)]);await a.router.structured('normalize',schema,'p');
    assert.deepEqual(a.calls.map(c=>c.model),['cheap-m']);
    const b=scripted([new Error('HTTP 404'),ok(2)]);
    assert.equal((await b.router.structured('normalize',schema,'p')).count,2);
    assert.deepEqual(b.calls.map(c=>c.model),['cheap-m','strong-m']);
  }finally{restore();}
});

test('edges stay on the strong model with a single repair retry, then fail',async()=>{
  const restore=env({LLM_EDGES:'strong-m',LLM_MAP:'cheap-m'});
  try{
    const a=scripted([bad,ok(3)]);
    assert.equal((await a.router.structured('edges',schema,'p')).count,3);
    assert.deepEqual(a.calls.map(c=>c.model),['strong-m','strong-m']);
    assert.match(a.calls[1].prompt,/Previous response was invalid/);
    const b=scripted([bad,bad]);
    await assert.rejects(()=>b.router.structured('edges',schema,'p'),/invalid or truncated/);
    assert.equal(b.calls.length,2);
  }finally{restore();}
});

test('CLAUDE_MODEL remains the fallback for strong roles; token budgets are per role',async()=>{
  const restore=env({CLAUDE_MODEL:'legacy-m',LLM_EDGES:undefined,LLM_ESCALATE:undefined});
  try{
    const a=scripted([ok(1)]);await a.router.structured('edges',schema,'p');
    assert.equal(a.calls[0].model,'legacy-m');assert.ok(a.calls[0].maxTokens<12000);
    const b=scripted([bad,bad,ok(1)]);await b.router.structured('map',schema,'p');
    assert.equal(b.calls[2].model,'legacy-m');assert.ok(b.calls[0].maxTokens<12000);assert.equal(b.calls[2].maxTokens,12000);
  }finally{restore();}
});

test('Anthropic request is a forced tool call, masks PII, caches the static prefix and reports usage',async(t)=>{
  const restore=env({ANTHROPIC_API_KEY:'test-only'});
  t.mock.method(globalThis,'fetch',async(_u:unknown,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    assert.equal(body.tool_choice.type,'tool');
    assert.ok(!body.messages[0].content.includes('person@example.com'));
    assert.equal(body.system[0].cache_control.type,'ephemeral');
    assert.equal(body.tools[0].cache_control.type,'ephemeral');
    assert.equal(body.model,'m1');
    return new Response(JSON.stringify({id:'x',type:'message',role:'assistant',content:[{type:'tool_use',id:'t',name:'submit_result',input:{count:2}}],stop_reason:'tool_use',usage:{input_tokens:11,output_tokens:4,cache_read_input_tokens:9}}),{status:200,headers:{'content-type':'application/json'}});
  });
  try{
    const r=await new AnthropicProvider().attempt({model:'m1',maxTokens:100,schema,prompt:'person@example.com'});
    assert.ok(r.ok&&r.value.count===2);
    assert.deepEqual([r.usage.inputTokens,r.usage.outputTokens,r.usage.cacheReadTokens],[11,4,9]);
  }finally{restore();}
});

test('missing API key reports actionable error',async()=>{
  const restore=env({ANTHROPIC_API_KEY:undefined});
  try{await assert.rejects(()=>new LlmRouter().structured('edges',z.object({}),''),/ANTHROPIC_API_KEY/);}finally{restore();}
});
