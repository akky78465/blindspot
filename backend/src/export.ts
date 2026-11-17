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
function namedValues(suggestion:Suggestion){
  const seen=new Map<string,number>();
  return suggestion.dataSpec.map((spec,i)=>{
    const base=spec.field.trim() || 'value';
    const count=(seen.get(base) ?? 0)+1;
    seen.set(base,count);
    return {field:count===1?base:`${base}_${count}`,value:generate(spec,`${suggestion.id}:${i}`)};
  });
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
function scenario(suggestion:Suggestion){
  const values=namedValues(suggestion);
  const lines=[...clauses('Given',suggestion.preconditions),...clauses('When',suggestion.steps),`    Then ${oneLine(suggestion.expectedResult)}`];
  const examples=values.length?`\n\n    Examples:\n      | ${values.map(v=>cell(v.field)).join(' | ')} |\n      | ${values.map(v=>cell(v.value)).join(' | ')} |`:'';
  return `  ${tag(suggestion.id)} ${tag(suggestion.priority)} ${tag(suggestion.category)}\n  ${values.length?'Scenario Outline':'Scenario'}: ${oneLine(suggestion.title)}\n${lines.join('\n')}${examples}`;
}
export function renderGherkin(session:Session,body:unknown){
  const selected=selectedFrom(session,body);
  return groups(session,selected).map(group=>{
    const about=group.description.trim()?group.description.trim().split(/\r?\n/).map(line=>`  ${oneLine(line)}`).join('\n')+'\n':'';
    return `Feature: ${oneLine(group.name) || 'Feature'}\n${about}\n${group.items.map(scenario).join('\n\n')}`;
  }).join('\n\n')+'\n';
}
export function renderPlaywright(session:Session,body:unknown){
  const tests=selectedFrom(session,body).map(suggestion=>{
    const steps=[...suggestion.preconditions.map(step=>`Given ${oneLine(step)}`),...suggestion.steps.map(step=>`When ${oneLine(step)}`),`Then ${oneLine(suggestion.expectedResult)}`];
    const calls=steps.map(step=>`  await test.step(${JSON.stringify(step)}, async () => {\n  });`).join('\n');
    return `test(${JSON.stringify(suggestion.title)}, async () => {\n  const data = ${JSON.stringify(Object.fromEntries(namedValues(suggestion).map(v=>[v.field,v.value])))};\n${calls}\n});`;
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
    const values=s.dataSpec.map((spec,i)=>({field:spec.field,value:generate(spec,`${s.id}:${i}`),kind:spec.kind}));
    edges.addRow([s.id,session.featureMap?.features.find(f=>f.id===s.featureId)?.name ?? s.featureId,s.title,s.category,s.priority,s.rationale,s.preconditions.join('\n'),s.steps.map((step,i)=>`${i+1}. ${step}`).join('\n'),JSON.stringify(values.map(({field,value})=>({field,value}))),s.expectedResult]);
    for(const v of values) data.addRow([s.id,v.field,JSON.stringify(v.value),v.kind]);
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
