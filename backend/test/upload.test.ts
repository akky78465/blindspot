import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUpload } from '../src/upload';
import { mask } from '../src/privacy';
import { Sessions } from '../src/sessions';
import { LlmRouter } from '../src/llm/router';
import { Role } from '../src/llm/types';
import { z } from 'zod';
const sample={originalname:'sample.xlsx',buffer:readFileSync('../samples/service-request-testcases.xlsx')} as Express.Multer.File;
class Stub extends LlmRouter {
  roles:Role[]=[];
  override async structured<T>(role:Role,schema:z.ZodType<T>,prompt:string):Promise<T>{this.roles.push(role);assert.ok(!prompt.includes('demo@example.test'));return schema.parse({testCases:[{id:'original',title:'Login',preconditions:[],steps:['Log in'],inputs:[],expectedResult:'Dashboard',type:'positive',sourceRef:'Service Requests row 2'}]});}
}
const csv=(text:string)=>({originalname:'cases.csv',buffer:Buffer.from(text)} as Express.Multer.File);
test('sample parses 25 rows with actual worksheet references',()=>{const chunks=parseUpload(sample);assert.equal(chunks.flat().length,25);assert.match(JSON.stringify(chunks),/Service Requests row 2/);assert.ok(!JSON.stringify(chunks).includes('demo@example.test'));});
test('masks emails, phones and cards',()=>assert.equal(mask('a@b.com +1 (415) 555-1234 card 4111 1111 1111 1111'),'[MASKED_EMAIL] [MASKED_PHONE] card [MASKED_CARD]'));
test('rejects empty/unsupported upload',()=>{assert.throws(()=>parseUpload());assert.throws(()=>parseUpload({...sample,originalname:'a.pdf'}));});
test('pasted text goes to the cheap normalize model, assigns IDs and stores session',async()=>{const stub=new Stub();const s=new Sessions(stub);const r=await s.upload(undefined,'Login with valid credentials');assert.deepEqual(stub.roles,['normalize']);assert.equal(r.testCases[0].id,'TC-001');assert.equal(s.get(r.sessionId).testCases.length,1);assert.equal(s.get(r.sessionId).usage.calls,0);});
test('a sheet that is already a test-case table skips the model entirely',async()=>{
  const stub=new Stub();const s=new Sessions(stub);const r=await s.upload(sample);
  assert.deepEqual(stub.roles,[]);assert.equal(r.testCases.length,25);
  const first=r.testCases[0];
  assert.equal(first.id,'TC-001');assert.equal(first.title,'Login with valid credentials');assert.equal(first.sourceRef,'Service Requests row 2');assert.equal(first.type,'positive');
  assert.deepEqual(first.steps,['Enter [MASKED_EMAIL] and SyntheticPass123!','select Sign in']);
  assert.deepEqual(first.inputs.map(i=>i.field),['email','password']);assert.equal(first.expectedResult,'Member dashboard opens and lists active plans');assert.equal(first.feature,'Login');
});
test('mixed sheets: recognized rows are mapped in code, others go to the model in order',async()=>{
  const stub=new Stub();const s=new Sessions(stub);
  const direct=csv('Title,Steps,Expected Result,Priority\nA,"1. one\n2. two",ok,High\n');
  const r=await s.upload(direct);
  assert.deepEqual(stub.roles,[]);assert.deepEqual(r.testCases[0].steps,['one','two']);assert.equal(r.testCases[0].priority,'high');
  const other=await s.upload(csv('Foo,Bar\nx,y\n'));
  assert.deepEqual(stub.roles,['normalize']);assert.equal(other.testCases.length,1);
});
test('CSV parses, preserves headers, and chunks at thirty rows',()=>{const file=csv('Title,Expected Result\n'+Array.from({length:65},(_,i)=>`Case ${i},Success`).join('\n'));const chunks=parseUpload(file);assert.deepEqual(chunks.map(c=>c.length),[30,30,5]);assert.match(JSON.stringify(chunks[2]),/row 66/);});
test('model path still chunks at thirty items',async()=>{const stub=new Stub();const s=new Sessions(stub);await s.upload(csv('Foo,Bar\n'+Array.from({length:65},(_,i)=>`a${i},b${i}`).join('\n')));assert.equal(stub.roles.length,3);});
