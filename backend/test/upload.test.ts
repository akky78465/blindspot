import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUpload } from '../src/upload';
import { mask } from '../src/privacy';
import { Sessions } from '../src/sessions';
import { ClaudeClient } from '../src/claude';
import { z } from 'zod';
const sample={originalname:'sample.xlsx',buffer:readFileSync('../samples/service-request-testcases.xlsx')} as Express.Multer.File;
class Stub extends ClaudeClient {override async structured<T>(schema:z.ZodType<T>,prompt:string):Promise<T>{assert.ok(!prompt.includes('demo@example.test'));return schema.parse({testCases:[{id:'original',title:'Login',preconditions:[],steps:['Log in'],inputs:[],expectedResult:'Dashboard',type:'positive',sourceRef:'Service Requests row 2'}]});}}
test('sample parses 25 rows with actual worksheet references',()=>{const chunks=parseUpload(sample);assert.equal(chunks.flat().length,25);assert.match(JSON.stringify(chunks),/Service Requests row 2/);assert.ok(!JSON.stringify(chunks).includes('demo@example.test'));});
test('masks emails, phones and cards',()=>assert.equal(mask('a@b.com +1 (415) 555-1234 card 4111 1111 1111 1111'),'[MASKED_EMAIL] [MASKED_PHONE] card [MASKED_CARD]'));
test('rejects empty/unsupported upload',()=>{assert.throws(()=>parseUpload());assert.throws(()=>parseUpload({...sample,originalname:'a.pdf'}));});
test('upload normalizes, assigns IDs and stores session',async()=>{const s=new Sessions(new Stub());const r=await s.upload(sample);assert.equal(r.testCases[0].id,'TC-001');assert.equal(s.get(r.sessionId).testCases.length,1);});
test('CSV parses, preserves headers, and chunks at thirty rows',()=>{const file={originalname:'cases.csv',buffer:Buffer.from('Title,Expected Result\n'+Array.from({length:65},(_,i)=>`Case ${i},Success`).join('\n'))} as Express.Multer.File;const chunks=parseUpload(file);assert.deepEqual(chunks.map(c=>c.length),[30,30,5]);assert.match(JSON.stringify(chunks[2]),/row 66/);});
