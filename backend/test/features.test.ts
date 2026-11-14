import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeded, map } from './fixtures';
test('feature map generates and permits rename',async()=>{const s=seeded();await s.mapFeatures('demo');const updated=structuredClone(map);updated.features[0].name='Member login';assert.equal(s.saveMap('demo',updated).features[0].name,'Member login');});
test('feature map rejects lost, foreign and duplicate cases',()=>{const s=seeded();for(const ids of [[],['foreign'],['TC-001','TC-001']]){const invalid=structuredClone(map);invalid.features[0].testCaseIds=ids;assert.throws(()=>s.saveMap('demo',invalid));}});
