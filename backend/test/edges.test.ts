import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {ClaudeClient} from '../src/claude';
import {seeded,map} from './fixtures';
class Stub extends ClaudeClient {calls=0;override async structured<T>(schema:z.ZodType<T>):Promise<T>{this.calls++;return schema.parse({suggestions:[{id:'llm',featureId:'wrong',title:'Empty password',category:'null_empty',priority:'high',rationale:'Existing login tests only valid password',preconditions:[],steps:['Submit empty password'],dataSpec:[{field:'password',kind:'empty'}],expectedResult:'Required field error'}]});}}
test('one call per feature, canonical IDs, priority and progress',async()=>{const client=new Stub();const s=seeded(client);s.saveMap('demo',map);const result=await s.edges('demo');assert.equal(client.calls,1);assert.equal(result.suggestions[0].featureId,'f1');assert.equal(result.suggestions[0].id,'EC-001');assert.equal(s.get('demo').progress.status,'complete');});
test('generation requires a feature map',async()=>{await assert.rejects(()=>seeded().edges('demo'));assert.throws(()=>seeded().beginEdges('demo'));});
test('beginEdges returns before generation finishes',async()=>{const client=new Stub();const s=seeded(client);s.saveMap('demo',map);assert.deepEqual(s.beginEdges('demo'),{started:true});assert.equal(s.get('demo').busy,true);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(s.get('demo').progress.status,'complete');assert.equal(s.get('demo').suggestions[0].id,'EC-001');});
test('failed feature generation unlocks session and reports failure without publishing partial cases',async()=>{class Failing extends ClaudeClient{override async structured<T>(_schema:z.ZodType<T>):Promise<T>{throw new Error('Claude unavailable');}}const s=seeded(new Failing());s.saveMap('demo',map);await assert.rejects(()=>s.edges('demo'),/Claude unavailable/);assert.equal(s.get('demo').busy,false);assert.equal(s.get('demo').progress.status,'failed');assert.deepEqual(s.get('demo').suggestions,[]);});
test('features run concurrently and IDs stay in feature order',async()=>{
  const delays:Record<string,number>={Login:60,Plans:10,Appliances:30};let active=0,peak=0;
  class Slow extends ClaudeClient{override async structured<T>(schema:z.ZodType<T>,prompt:string):Promise<T>{active++;peak=Math.max(peak,active);const name=Object.keys(delays).find(n=>prompt.includes(n))!;await new Promise(r=>setTimeout(r,delays[name]));active--;return schema.parse({suggestions:[{id:'x',featureId:'x',title:`${name} edge`,category:'null_empty',priority:'medium',rationale:'r',preconditions:[],steps:['s'],dataSpec:[],expectedResult:'e'}]});}}
  const s=seeded(new Slow());const f=map.features[0];
  s.saveMap('demo',{features:[f,{...f,id:'f2',name:'Plans',testCaseIds:[]},{...f,id:'f3',name:'Appliances',testCaseIds:[]}]});
  const result=await s.edges('demo');
  assert.equal(peak,3);
  assert.deepEqual(result.suggestions.map(x=>[x.id,x.featureId]),[['EC-001','f1'],['EC-002','f2'],['EC-003','f3']]);
  assert.equal(s.get('demo').progress.completed,3);assert.equal(s.get('demo').progress.current,'');
});
