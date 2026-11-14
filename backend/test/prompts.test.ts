import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {LlmRouter} from '../src/llm/router';
import {Role,Usage} from '../src/llm/types';
import {edgesPrompt,edgeCap} from '../src/prompts/edges';
import {featuresPrompt} from '../src/prompts/features';
import {seeded,map} from './fixtures';

type Cats=typeof map.features[0]['coveredCategories'];
test('edge prompt lists uncovered categories, caps output and omits full steps',()=>{
  const feature={...map.features[0],coveredCategories:['boundary','format','length','security','domain','permissions','concurrency','state_transition','date_time'] as Cats,uncoveredCategories:['null_empty','special_chars'] as Cats};
  const c={id:'TC-001',title:'Login',preconditions:['Account exists'],steps:['Open page','Click sign in'],inputs:[{field:'email',value:'a@b.test'}],type:'positive' as const,sourceRef:'row 2',expectedResult:'Dashboard opens'};
  const prompt=edgesPrompt(feature,[c]);
  assert.equal(edgeCap(feature),4);assert.match(prompt,/at most 4 focused/);
  assert.match(prompt,/"uncoveredCategories":\["null_empty","special_chars"\]/);
  assert.ok(!prompt.includes('Click sign in')&&!prompt.includes('Account exists')&&!prompt.includes('testCaseIds')&&!prompt.includes('"coveredCategories"'));
  assert.match(prompt,/"fields":\["email"\]/);
  assert.equal(edgeCap(map.features[0]),8);
  assert.ok(featuresPrompt([c]).includes('Dashboard opens')&&!featuresPrompt([c]).includes('Click sign in'));
});

test('local gate drops covered-category suggestions but keeps domain gaps',async()=>{
  const make=(title:string,category:string)=>({id:'x',featureId:'x',title,category,priority:'high',rationale:'r',preconditions:[],steps:['s'],dataSpec:[],expectedResult:'e'});
  class Mixed extends LlmRouter{override async structured<T>(_role:Role,schema:z.ZodType<T>):Promise<T>{return schema.parse({suggestions:[make('A','boundary'),make('B','null_empty'),make('C','domain')]});}}
  const s=seeded(new Mixed());
  s.saveMap('demo',{features:[{...map.features[0],coveredCategories:['boundary','domain'],uncoveredCategories:map.features[0].uncoveredCategories.filter(c=>c!=='boundary'&&c!=='domain')}]});
  const result=await s.edges('demo');
  assert.deepEqual(result.suggestions.map(x=>x.title).sort(),['B','C']);
});

test('edge usage is recorded on the session',async()=>{
  class Metered extends LlmRouter{override async structured<T>(role:Role,schema:z.ZodType<T>,_p?:string,sink?:(r:Role,u:Usage)=>void):Promise<T>{sink?.(role,{inputTokens:10,outputTokens:5,cacheReadTokens:3,cacheCreationTokens:0,calls:1});return schema.parse({suggestions:[]});}}
  const s=seeded(new Metered());s.saveMap('demo',map);await s.edges('demo');
  const u=s.get('demo').usage;
  assert.equal(u.inputTokens,10);assert.equal(u.cacheReadTokens,3);assert.equal(u.byRole.edges?.calls,1);
});
