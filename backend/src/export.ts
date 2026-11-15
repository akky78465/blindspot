import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Session } from './sessions';
import { generate } from './data';
import { categories } from './schemas';
export async function exportWorkbook(session:Session,body:unknown) {
  const parsed=z.object({selectedIds:z.array(z.string()).min(1).max(1000)}).safeParse(body);
  if(!parsed.success) throw new BadRequestException('Select at least one suggestion to export.');
  const ids=new Set(parsed.data.selectedIds);
  if([...ids].some(id=>!session.suggestions.some(s=>s.id===id))) throw new BadRequestException('One or more selected suggestions are no longer available.');
  const selected=session.suggestions.filter(s=>ids.has(s.id));
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
