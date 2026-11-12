import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {ClaudeClient} from '../src/claude';
test('forced tool validation retries once with errors and masks prompt',async(t)=>{
 const saved=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY='test-only';let calls=0;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{calls++;const body=JSON.parse(String(init.body));assert.equal(body.tool_choice.type,'tool');assert.ok(!body.messages[0].content.includes('person@example.com'));if(calls===2)assert.match(body.messages[0].content,/Previous response was invalid/);return new Response(JSON.stringify({id:'x',type:'message',role:'assistant',content:[{type:'tool_use',id:'t',name:'submit_result',input:calls===1?{count:'bad'}:{count:2}}],stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1}}),{status:200,headers:{'content-type':'application/json'}});});
 try{const value=await new ClaudeClient().structured(z.object({count:z.number()}),'person@example.com');assert.equal(value.count,2);assert.equal(calls,2);}finally{if(saved===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=saved;}
});
test('missing API key reports actionable error',async()=>{const saved=process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_API_KEY;try{await assert.rejects(()=>new ClaudeClient().structured(z.object({}),''),/ANTHROPIC_API_KEY/);}finally{if(saved!==undefined)process.env.ANTHROPIC_API_KEY=saved;}});
