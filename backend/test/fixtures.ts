import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sessions } from '../src/sessions';
import { ClaudeClient } from '../src/claude';
import { categories, FeatureMap } from '../src/schemas';
import { z } from 'zod';
export const map:FeatureMap={features:[{id:'f1',name:'Login',description:'Member login',fields:[],rules:[],flows:[],testCaseIds:['TC-001'],coveredCategories:[],uncoveredCategories:[...categories]}]};
class Stub extends ClaudeClient {override async structured<T>(schema:z.ZodType<T>):Promise<T>{return schema.parse(map);}}
export function seeded(client:ClaudeClient=new Stub()){const s=new Sessions(client);s.sessions.set('demo',{testCases:[{id:'TC-001',title:'Login',preconditions:[],steps:[],inputs:[],type:'positive',sourceRef:'row 2',expectedResult:'Success'}],suggestions:[],busy:false,created:Date.now(),progress:{completed:0,total:0,current:'',status:'idle',error:''}});return s;}
