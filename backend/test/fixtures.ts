import { Sessions } from '../src/sessions';
import { LlmRouter } from '../src/llm/router';
import { newTotals } from '../src/llm/types';
import { categories, FeatureMap } from '../src/schemas';
import { z } from 'zod';
export const map:FeatureMap={features:[{id:'f1',name:'Login',description:'Member login',fields:[],rules:[],flows:[],testCaseIds:['TC-001'],coveredCategories:[],uncoveredCategories:[...categories]}]};
class Stub extends LlmRouter {override async structured<T>(_role:unknown,schema:z.ZodType<T>):Promise<T>{return schema.parse(map);}}
export function seeded(client:LlmRouter=new Stub()){const s=new Sessions(client);s.sessions.set('demo',{testCases:[{id:'TC-001',title:'Login',preconditions:[],steps:[],inputs:[],type:'positive',sourceRef:'row 2',expectedResult:'Success'}],suggestions:[],busy:false,created:Date.now(),usage:newTotals(),progress:{completed:0,total:0,current:'',status:'idle',error:''}});return s;}
