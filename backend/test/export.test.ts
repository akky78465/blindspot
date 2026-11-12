import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {generate} from '../src/data';
import {exportWorkbook} from '../src/export';
import {seeded,map} from './fixtures';
test('deterministic values and exact boundaries',()=>{assert.equal(generate({field:'x',kind:'boundary',params:{max:20,side:'max',offset:1}},'a'),21);assert.equal(generate({field:'x',kind:'email'},'a'),generate({field:'x',kind:'email'},'a'));assert.equal(String(generate({field:'x',kind:'invalid_length',params:{length:4}},'a')).length,4);});
test('export round-trips three sheets and preserves injection as text',async()=>{const s=seeded();s.saveMap('demo',map);s.get('demo').suggestions=[{id:'EC-1',featureId:'f1',title:'=1+1',category:'security',priority:'high',rationale:'Missing injection',preconditions:[],steps:[],dataSpec:[{field:'query',kind:'sql_injection'}],expectedResult:'Rejected'}];const book=await exportWorkbook(s.get('demo'),{selectedIds:['EC-1']});const copy=new ExcelJS.Workbook();await copy.xlsx.load(await book.xlsx.writeBuffer());assert.deepEqual(copy.worksheets.map(s=>s.name),['Edge Cases','Test Data','Summary']);assert.equal(copy.getWorksheet('Edge Cases')?.getCell('C2').type,ExcelJS.ValueType.String);assert.equal(copy.getWorksheet('Test Data')?.rowCount,2);await assert.rejects(()=>exportWorkbook(s.get('demo'),{selectedIds:['bad']}));});
