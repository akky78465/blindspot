import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compose} from '../src/agents/agent';
import {agents} from '../src/agents/index';
import {edgesPrompt} from '../src/prompts/edges';
import {featuresPrompt} from '../src/prompts/features';
import {normalizePrompt} from '../src/prompts/normalize';
import {categories, TestCase} from '../src/schemas';

const chunk=[{title:'Login'}];
const cases:TestCase[]=[{id:'TC-001',title:'Login',preconditions:[],steps:['Log in'],inputs:[],expectedResult:'Dashboard',type:'positive',sourceRef:'row 2'}];
const feature={id:'f1',name:'Login',description:'Member login',fields:[],rules:[],flows:[],testCaseIds:['TC-001'],coveredCategories:[],uncoveredCategories:[...categories],selected:true};

test('catalog names and composed prompts match the original functions',()=>{
  assert.deepEqual(Object.values(agents).map(agent=>agent.name),['normalizer','feature-mapper','edge-case']);
  assert.equal(compose(agents.normalizer,chunk),normalizePrompt(chunk));
  assert.equal(compose(agents.featureMapper,cases),featuresPrompt(cases));
  assert.equal(compose(agents.edgeCase,{feature,cases}),edgesPrompt(feature,cases));
  assert.equal(agents.normalizer.output.safeParse({testCases:cases}).success,true);
});
