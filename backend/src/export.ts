import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Session } from './sessions';
import { generate } from './data';
import { categories, Suggestion } from './schemas';
const formats=['xlsx','gherkin','playwright'] as const;
export type ExportFormat=(typeof formats)[number];
const bodySchema=z.object({selectedIds:z.array(z.string()).min(1).max(1000),format:z.enum(formats).optional()});
export function exportFormat(body:unknown):ExportFormat {
  if(!body || typeof body!=='object' || Array.isArray(body)) return 'xlsx';
  const format=(body as {format?:unknown}).format;
  if(format===undefined) return 'xlsx';
  if(format==='xlsx' || format==='gherkin' || format==='playwright') return format;
  throw new BadRequestException('Choose an export format of xlsx, gherkin, or playwright.');
}
function selectedFrom(session:Session,body:unknown) {
  const parsed=bodySchema.safeParse(body);
  if(!parsed.success) throw new BadRequestException(parsed.error.issues.some(issue=>issue.path[0]==='format')?'Choose an export format of xlsx, gherkin, or playwright.':'Select at least one suggestion to export.');
  const ids=new Set(parsed.data.selectedIds);
  if([...ids].some(id=>!session.suggestions.some(s=>s.id===id))) throw new BadRequestException('One or more selected suggestions are no longer available.');
  return session.suggestions.filter(s=>ids.has(s.id));
}
function oneLine(value:string){return value.replace(/\s+/g,' ').trim();}
function tag(value:string){return `@${value.trim().replace(/\s+/g,'-').replace(/[^\w.-]/g,'') || 'case'}`;}
function clauses(keyword:string,lines:string[]){return lines.map(oneLine).filter(Boolean).map((line,i)=>`    ${i===0?keyword:'And'} ${line}`);}
function cell(value:unknown){return value===null||value===undefined?'':String(value).replace(/\r?\n/g,' ').replace(/\|/g,'\\|');}
function norm(name:string){return name.trim().toLowerCase().replace(/\s+/g,' ');}
function baselineInputs(session:Session,suggestion:Suggestion){
  const feature=session.featureMap?.features.find(item=>item.id===suggestion.featureId);
  const allowed=new Set(feature?.testCaseIds ?? []);
  const cases=session.testCases.filter(testCase=>!allowed.size || allowed.has(testCase.id));
  const varied=new Set(suggestion.dataSpec.map(spec=>norm(spec.field)));
  const score=(testCase:Session['testCases'][number])=>{
    const inputs=testCase.inputs.filter(input=>input.field.trim());
    return inputs.filter(input=>varied.has(norm(input.field))).length*100+(testCase.type==='positive'?10:0)+inputs.length;
  };
  return [...cases].filter(testCase=>testCase.inputs.some(input=>input.field.trim())).sort((a,b)=>score(b)-score(a))[0]?.inputs.filter(input=>input.field.trim()) ?? [];
}
function recordValues(session:Session,suggestion:Suggestion){
  const rows:{field:string;value:string|number|boolean|null;kind:string}[]=[];
  const seen=new Set<string>();
  const used=new Set<number>();
  for(const input of baselineInputs(session,suggestion)){
    const key=norm(input.field);
    if(seen.has(key)) continue;
    seen.add(key);
    const index=suggestion.dataSpec.findIndex((spec,i)=>!used.has(i) && norm(spec.field)===key);
    if(index>=0){used.add(index);rows.push({field:input.field,value:generate(suggestion.dataSpec[index],`${suggestion.id}:${index}`),kind:suggestion.dataSpec[index].kind});}
    else rows.push({field:input.field,value:input.value,kind:'given'});
  }
  suggestion.dataSpec.forEach((spec,index)=>{
    if(used.has(index)) return;
    const field=spec.field.trim() || 'value';
    seen.add(norm(field));
    rows.push({field,value:generate(spec,`${suggestion.id}:${index}`),kind:spec.kind});
  });
  const counts=new Map<string,number>();
  return rows.map(row=>{
    const base=row.field.trim() || 'value';
    const count=(counts.get(base) ?? 0)+1;
    counts.set(base,count);
    return {...row,field:count===1?base:`${base}_${count}`};
  });
}
function formatTestData(rows:{field:string;value:string|number|boolean|null}[]){
  return rows.map(row=>`"Field": ${JSON.stringify(row.field)}, "value": ${JSON.stringify(row.value)}`).join('\n');
}
function sheetValue(value:string|number|boolean|null){
  if(typeof value==='number' || typeof value==='boolean') return value;
  if(value===null || value===undefined) return '';
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
function groups(session:Session,selected:Suggestion[]){
  const features=session.featureMap?.features ?? [];
  const known=new Set(features.map(f=>f.id));
  const blocks=features.flatMap(feature=>{
    const items=selected.filter(s=>s.featureId===feature.id);
    return items.length?[{name:feature.name,description:feature.description,items}]:[];
  });
  for(const id of [...new Set(selected.map(s=>s.featureId).filter(featureId=>!known.has(featureId)))]) blocks.push({name:id,description:'',items:selected.filter(s=>s.featureId===id)});
  return blocks;
}
function scenario(session:Session,suggestion:Suggestion){
  const values=recordValues(session,suggestion);
  const lines=[...clauses('Given',suggestion.preconditions),...clauses('When',suggestion.steps),`    Then ${oneLine(suggestion.expectedResult)}`];
  const examples=values.length?`\n\n    Examples:\n      | ${values.map(v=>cell(v.field)).join(' | ')} |\n      | ${values.map(v=>cell(v.value)).join(' | ')} |`:'';
  return `  ${tag(suggestion.id)} ${tag(suggestion.priority)} ${tag(suggestion.category)}\n  ${values.length?'Scenario Outline':'Scenario'}: ${oneLine(suggestion.title)}\n${lines.join('\n')}${examples}`;
}
export function renderGherkin(session:Session,body:unknown){
  const selected=selectedFrom(session,body);
  return groups(session,selected).map(group=>{
    const about=group.description.trim()?group.description.trim().split(/\r?\n/).map(line=>`  ${oneLine(line)}`).join('\n')+'\n':'';
    return `Feature: ${oneLine(group.name) || 'Feature'}\n${about}\n${group.items.map(item=>scenario(session,item)).join('\n\n')}`;
  }).join('\n\n')+'\n';
}
export function renderPlaywright(session:Session,body:unknown){
  const tests=selectedFrom(session,body).map(suggestion=>{
    const steps=[...suggestion.preconditions.map(step=>`Given ${oneLine(step)}`),...suggestion.steps.map(step=>`When ${oneLine(step)}`),`Then ${oneLine(suggestion.expectedResult)}`];
    const calls=steps.map(step=>`  await test.step(${JSON.stringify(step)}, async () => {\n  });`).join('\n');
    return `test(${JSON.stringify(suggestion.title)}, async () => {\n  const data = ${JSON.stringify(Object.fromEntries(recordValues(session,suggestion).map(v=>[v.field,v.value])))};\n${calls}\n});`;
  }).join('\n\n');
  return `// Locators are intentionally absent. Fill in each step against the app under test.\nimport { test } from '@playwright/test';\n\n${tests}\n`;
}
export async function exportWorkbook(session:Session,body:unknown) {
  const selected=selectedFrom(session,body);
  const book=new ExcelJS.Workbook();book.creator='Maryada';
  const edges=book.addWorksheet('Edge Cases');const data=book.addWorksheet('Test Data');const summary=book.addWorksheet('Summary');
  edges.addRow(['ID','Feature','Title','Category','Priority','Rationale','Preconditions','Steps','Test Data','Expected Result']);
  data.addRow(['ID','Field','Value','Kind']);
  for(const s of selected){
    const values=recordValues(session,s);
    edges.addRow([s.id,session.featureMap?.features.find(f=>f.id===s.featureId)?.name ?? s.featureId,s.title,s.category,s.priority,s.rationale,s.preconditions.join('\n'),s.steps.map((step,i)=>`${i+1}. ${step}`).join('\n'),formatTestData(values),s.expectedResult]);
    for(const v of values){const row=data.addRow([s.id,v.field,'',v.kind]);row.getCell(3).value=sheetValue(v.value);}
  }
  summary.addRow(['Metric','Feature / category','Before','After / selected']);
  summary.addRow(['Test case count','All',session.testCases.length,session.testCases.length+selected.length]);
  summary.addRow(['Selected suggestions','All',0,selected.length]);
  for(const f of session.featureMap?.features ?? []) {
    const added=selected.filter(s=>s.featureId===f.id);
    const covered=new Set(f.coveredCategories).size;
    if(f.selected===false) summary.addRow(['Not analyzed',f.name,covered,'']);
    summary.addRow(['Case count',f.name,f.testCaseIds.length,f.testCaseIds.length+added.length]);
    summary.addRow(['Categories represented (of 11)',f.name,covered,new Set([...f.coveredCategories,...added.map(s=>s.category)]).size]);
  }
  for(const category of categories) summary.addRow(['Selected category',category,'',selected.filter(s=>s.category===category).length]);
  summary.addRow(['Note','Coverage is inferred category representation, not executed tests or proven completeness.']);
  for(const sheet of book.worksheets){
    sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:sheet.columnCount}};
    sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173F35'}};
    sheet.columns.forEach((col,i)=>{col.width=i===0?22:38;});
    sheet.eachRow(row=>{row.alignment={vertical:'top',wrapText:true};});
  }
  return book;
}
