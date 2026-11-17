import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUpload } from '../src/upload';
import { chunkApiCases, parseTestRail } from '../src/testrail';
import { Sessions } from '../src/sessions';
import { ClaudeClient } from '../src/claude';
import { z } from 'zod';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<suite><name>Master</name><sections><section><name>Login</name><cases><case>
<id>C10</id><title>Valid login</title><template>Test Case (Steps)</template><type>Functional</type><priority>High</priority>
<custom><preconds>Account demo@example.test exists</preconds><steps_separated>
<step><content>Open &amp; continue<br/>now</content><expected>Form is shown</expected></step>
<step><content>Submit the password</content><expected>Dashboard opens</expected></step>
</steps_separated></custom></case></cases><sections><section><name>Recovery</name><cases><case>
<id>C11</id><title>Reset password</title><custom><preconds>Account exists</preconds><steps>1. Open reset</steps><expected>Email is sent</expected></custom>
</case></cases></section></sections></section></sections></suite>`;

const file = (name: string, contents: string) => ({ originalname: name, buffer: Buffer.from(contents) }) as Express.Multer.File;

test('TestRail XML keeps sections, separated steps, and masks contact data', () => {
  const rows = parseTestRail(file('suite.xml', xml)).flat() as { sourceRef: string; row: Record<string, string> }[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceRef, 'TestRail C10 · Master / Login');
  assert.equal(rows[0].row.title, 'Valid login');
  assert.match(rows[0].row.steps, /1\. Open & continue\nnow/);
  assert.match(rows[0].row.steps, /Expected: Form is shown/);
  assert.match(rows[0].row.steps, /2\. Submit the password/);
  assert.equal(rows[0].row.priority, 'High');
  assert.equal(rows[1].sourceRef, 'TestRail C11 · Master / Login / Recovery');
  assert.equal(rows[1].row.steps, '1. Open reset');
  assert.equal(rows[1].row.expectedResult, 'Email is sent');
  assert.equal(JSON.stringify(rows).includes('demo@example.test'), false);
  assert.match(JSON.stringify(rows), /\[MASKED_EMAIL\]/);
});

test('TestRail CSV groups separated steps for the same case and chunks at thirty', () => {
  const header = 'ID,Title,Template,Section Hierarchy,Preconditions,"Steps (Step)","Steps (Expected Result)"';
  const repeated = ['C10,Login,Test Case (Steps),Suite > Auth,User exists,Open page,Form shows', 'C10,Login,Test Case (Steps),Suite > Auth,User exists,Submit password,Dashboard opens', 'C11,Logout,Test Case (Text),Suite > Auth,,Click logout,Signed out'];
  const extra = Array.from({ length: 29 }, (_, i) => `C${i + 12},Case ${i},Test Case (Text),Suite,,Do ${i},Done ${i}`);
  const rows = parseTestRail(file('cases.csv', [header, ...repeated, ...extra].join('\n')));
  const flat = rows.flat() as { sourceRef: string; row: Record<string, string> }[];
  assert.deepEqual(rows.map(chunk => chunk.length), [30, 1]);
  assert.equal(flat[0].sourceRef, 'TestRail C10 · Suite > Auth');
  assert.match(flat[0].row.steps, /1\. Open page/);
  assert.match(flat[0].row.steps, /2\. Submit password/);
  assert.equal(flat[0].row.expectedResult, undefined);
  assert.match(flat[1].row.steps, /Expected: Signed out/);
});

test('selected TestRail API cases keep section paths, steps, and masking', () => {
  const chunks = chunkApiCases([
    { id: 10, title: 'Valid login', section_id: 3, template_id: 2, type_id: 1, priority_id: 4, custom_preconds: 'Account demo@example.test exists', custom_steps_separated: [{ content: 'Open login', expected: 'Form is shown' }, { content: 'Submit password', expected: 'Dashboard opens', additional_info: 'Use the synthetic password' }] },
    { id: 11, title: 'Reset password', section_id: 3, template_id: 1, type_id: 1, priority_id: 2, custom_steps: '1. Open reset', custom_expected: 'Email is sent' },
  ], [{ id: 2, name: 'Master', parent_id: null }, { id: 3, name: 'Login', parent_id: 2 }], { priorities: { 4: 'Critical', 2: 'Medium' }, types: { 1: 'Functional' }, templates: { 1: 'Text', 2: 'Steps' } });
  const rows = chunks.flat() as { sourceRef: string; row: Record<string, string> }[];
  assert.equal(rows[0].sourceRef, 'TestRail C10 · Master / Login');
  assert.equal(rows[0].row.priority, 'Critical');
  assert.match(rows[0].row.steps, /1\. Open login/);
  assert.match(rows[0].row.steps, /Notes: Use the synthetic password/);
  assert.equal(rows[1].row.expectedResult, 'Email is sent');
  assert.equal(JSON.stringify(rows).includes('demo@example.test'), false);
});

test('rejects files that are not TestRail exports', () => {
  assert.throws(() => parseTestRail(file('notes.csv', 'ID,Title,Preconditions,Steps,Expected Result\nSRC-1,Login,none,do,ok')), /does not look like a TestRail/);
  assert.throws(() => parseTestRail(file('empty.xml', '<suite><name>Empty</name></suite>')), /No TestRail cases/);
  assert.throws(() => parseTestRail(file('cases.pdf', 'nope')), /accepts \.xml/);
  assert.throws(() => parseUpload(file('suite.xml', xml)), /Only \.xlsx and \.csv/);
});

test('TestRail upload stores a session through the existing normalizer', async () => {
  class Stub extends ClaudeClient { override async structured<T>(schema: z.ZodType<T>) { return schema.parse({ testCases: [{ id: 'original', title: 'Valid login', preconditions: [], steps: ['Open the login page'], inputs: [], expectedResult: 'Dashboard', type: 'positive', sourceRef: 'TestRail C10 · Master / Login' }] }); } }
  const sessions = new Sessions(new Stub());
  const result = await sessions.uploadTestRail(file('suite.xml', xml));
  assert.equal(result.testCases.length, 1);
  assert.equal(result.testCases[0].id, 'TC-001');
  assert.equal(sessions.get(result.sessionId).testCases[0].sourceRef, 'TestRail C10 · Master / Login');
});
