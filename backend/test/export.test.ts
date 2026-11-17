import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {generate} from '../src/data';
import {exportWorkbook,renderGherkin,renderPlaywright} from '../src/export';
import {categories} from '../src/schemas';
import {seeded,map} from './fixtures';
test('deterministic values and exact boundaries',()=>{assert.equal(generate({field:'x',kind:'boundary',params:{max:20,side:'max',offset:1}},'a'),21);assert.equal(generate({field:'x',kind:'email'},'a'),generate({field:'x',kind:'email'},'a'));assert.equal(String(generate({field:'x',kind:'invalid_length',params:{length:4}},'a')).length,4);});
test('export round-trips three sheets and preserves injection as text',async()=>{const s=seeded();s.saveMap('demo',map);s.get('demo').suggestions=[{id:'EC-1',featureId:'f1',title:'=1+1',category:'security',priority:'high',rationale:'Missing injection',preconditions:[],steps:[],dataSpec:[{field:'query',kind:'sql_injection'}],expectedResult:'Rejected'}];const book=await exportWorkbook(s.get('demo'),{selectedIds:['EC-1']});const copy=new ExcelJS.Workbook();await copy.xlsx.load(await book.xlsx.writeBuffer());assert.deepEqual(copy.worksheets.map(s=>s.name),['Edge Cases','Test Data','Summary']);assert.equal(copy.getWorksheet('Edge Cases')?.getCell('C2').type,ExcelJS.ValueType.String);assert.equal(copy.getWorksheet('Test Data')?.rowCount,2);await assert.rejects(()=>exportWorkbook(s.get('demo'),{selectedIds:['bad']}));});
test('summary lists unselected features as not analyzed and keeps covered counts',async()=>{
  const s=seeded();const f=map.features[0];
  s.saveMap('demo',{features:[f,{...f,id:'f2',name:'Plans',testCaseIds:[],selected:false,coveredCategories:['format','length'],uncoveredCategories:categories.filter(c=>c!=='format'&&c!=='length')}]});
  s.get('demo').suggestions=[{id:'EC-1',featureId:'f1',title:'Gap',category:'security',priority:'high',rationale:'r',preconditions:[],steps:[],dataSpec:[],expectedResult:'e'}];
  const book=await exportWorkbook(s.get('demo'),{selectedIds:['EC-1']});const copy=new ExcelJS.Workbook();await copy.xlsx.load(await book.xlsx.writeBuffer());
  const rows:unknown[][]=[];copy.getWorksheet('Summary')!.eachRow(row=>rows.push([1,2,3,4].map(i=>row.getCell(i).value)));
  const status=rows.find(r=>r[0]==='Not analyzed'&&r[1]==='Plans');
  assert.equal(Number(status?.[2]),2);
  assert.equal(Number(rows.find(r=>r[0]==='Categories represented (of 11)'&&r[1]==='Plans')?.[2]),2);
  assert.equal(rows.some(r=>r[0]==='Not analyzed'&&r[1]==='Login'),false);
});
function withSuggestion(){
  const s=seeded();s.saveMap('demo',map);
  s.get('demo').suggestions=[{id:'EC-1',featureId:'f1',title:'Reject oversized name',category:'boundary',priority:'high',rationale:'Missing max',preconditions:['Member is signed in'],steps:['Enter the name'],dataSpec:[{field:'name',kind:'boundary',params:{max:20,side:'max',offset:1}}],expectedResult:'The name is rejected'}];
  return s;
}
test('gherkin contains the suggestion title, a Then line, and a generated value',()=>{
  const feature=renderGherkin(withSuggestion().get('demo'),{selectedIds:['EC-1'],format:'gherkin'});
  assert.match(feature,/Reject oversized name/);
  assert.match(feature,/^\s*Then /m);
  assert.match(feature,/21/);
});
test('playwright is a skeleton without locators',()=>{
  const spec=renderPlaywright(withSuggestion().get('demo'),{selectedIds:['EC-1'],format:'playwright'});
  assert.match(spec,/test\(/);
  assert.match(spec,/test\.step/);
  assert.equal(spec.includes('page.'),false);
});
test('default export with no format is still an Excel workbook',async()=>{
  const book=await exportWorkbook(withSuggestion().get('demo'),{selectedIds:['EC-1']});
  const copy=new ExcelJS.Workbook();await copy.xlsx.load(await book.xlsx.writeBuffer());
  assert.deepEqual(copy.worksheets.map(sheet=>sheet.name),['Edge Cases','Test Data','Summary']);
});
