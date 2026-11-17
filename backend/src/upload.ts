import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { mask } from './privacy';
import { TestCase } from './schemas';
const narrative = /^(scenario|title|steps?|expected(\s+result)?|preconditions?|given|when|then|and|id|type|priority|description)$/i;
const maskedValue = /\[MASKED_(EMAIL|PHONE|CARD)\]/;
export interface OriginalRecord { sourceRef: string; inputs: {field: string; value: string}[] }
export function parseUpload(file?: Express.Multer.File, text?: unknown): unknown[][] {
  if (file && typeof text==='string' && text.trim()) throw new BadRequestException('Provide a file or pasted text, not both.');
  if (!file) {
    if (typeof text!=='string' || !text.trim()) throw new BadRequestException('Upload an Excel/CSV file or paste test cases.');
    if (text.length>100000) throw new BadRequestException('Pasted text is limited to 100,000 characters.');
    return [[{sourceRef:'Pasted text',text:mask(text)}]];
  }
  if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new BadRequestException('Only .xlsx and .csv files are supported.');
  try {
    const rows = sheetRows(file).map(item => ({sourceRef:item.sourceRef, row:JSON.parse(mask(JSON.stringify(item.row)))}));
    if (!rows.length || rows.length>600) throw new Error('Use between 1 and 600 data rows.');
    if (JSON.stringify(rows).length>500000) throw new Error('Workbook text exceeds 500,000 characters.');
    return Array.from({length:Math.ceil(rows.length/30)},(_,i)=>rows.slice(i*30,i*30+30));
  } catch (e) { throw new BadRequestException(e instanceof Error ? `Cannot read upload: ${e.message}` : 'Cannot read workbook.'); }
}
export function originalInputs(file?: Express.Multer.File, text?: unknown): OriginalRecord[] {
  if (!file) return typeof text === 'string' && text.trim() ? pastedRecords(text) : [];
  return sheetRows(file).map(item => ({
    sourceRef: item.sourceRef,
    inputs: Object.entries(item.row).filter(([key, value]) => !key.startsWith('__') && String(value ?? '').trim()).map(([field, value]) => ({field, value: String(value)})),
  })).filter(item => item.inputs.length);
}
export function applyOriginalInputs(cases: TestCase[], records: OriginalRecord[]): TestCase[] {
  const used = new Set<number>();
  return cases.map(testCase => {
    const index = matchRecord(testCase.sourceRef, records, cases.length, used);
    if (index < 0) return testCase;
    used.add(index);
    return mergeInputs(testCase, records[index].inputs);
  });
}
function matchRecord(sourceRef: string, records: OriginalRecord[], caseCount: number, used: Set<number>) {
  const exact = records.findIndex((record, index) => !used.has(index) && record.sourceRef === sourceRef);
  if (exact >= 0) return exact;
  if (records.length === 1 && caseCount === 1 && !used.has(0)) return 0;
  if (records.length !== 1) return -1;
  const base = records[0].sourceRef.replace(/ case \d+$/, '');
  return !used.has(0) && (sourceRef === base || sourceRef.startsWith(`${base} case`)) ? 0 : -1;
}
function mergeInputs(testCase: TestCase, originals: OriginalRecord['inputs']): TestCase {
  if (!originals.length) return testCase;
  if (!testCase.inputs.length) return {...testCase, inputs: originals.map(input => ({field: input.field, value: input.value}))};
  const modelByField = new Map(testCase.inputs.map(input => [norm(input.field), input]));
  const seen = new Set<string>();
  const inputs = originals.map(input => {
    const key = norm(input.field);
    seen.add(key);
    const fromModel = modelByField.get(key);
    if (!fromModel || maskedValue.test(fromModel.value)) return {field: input.field, value: input.value, ...(fromModel?.type ? {type: fromModel.type} : {})};
    return fromModel;
  });
  for (const input of testCase.inputs) if (!seen.has(norm(input.field))) inputs.push(input);
  return {...testCase, inputs};
}
function pastedRecords(text: string): OriginalRecord[] {
  const blocks = text.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  const groups = (blocks.length ? blocks : [text]).map(parseLabeledFields).filter(inputs => inputs.length);
  return groups.map((inputs, index) => ({sourceRef: `Pasted text case ${index + 1}`, inputs}));
}
function parseLabeledFields(text: string) {
  const inputs: {field: string; value: string}[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:\n]{1,80}?)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const field = match[1].trim().replace(/\s+/g, ' ');
    if (!field || narrative.test(field)) continue;
    inputs.push({field, value: match[2].trim()});
  }
  return inputs;
}
function norm(name: string) { return name.trim().toLowerCase().replace(/\s+/g, ' '); }
function sheetRows(file: Express.Multer.File) {
  if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new BadRequestException('Only .xlsx and .csv files are supported.');
  const book = XLSX.read(file.buffer, {type: 'buffer', cellDates: true});
  const rows: {sourceRef: string; row: Record<string, unknown>}[] = [];
  for (const name of book.SheetNames) {
    const values = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], {defval: '', raw: false});
    for (const row of values) rows.push({sourceRef: `${name} row ${(row as {__rowNum__: number}).__rowNum__ + 1}`, row});
  }
  return rows;
}
