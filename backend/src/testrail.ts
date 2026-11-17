import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { mask } from './privacy';

interface XmlNode { name: string; children: XmlNode[]; text: string }
interface BuiltCase {
  id: string; title: string; section: string; template: string; type: string; priority: string;
  preconditions: string; references: string; steps: string[]; stepExpected: string[]; plainSteps: string; plainExpected: string;
}

const blocks = new Set(['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4']);
const distinctive = ['section hierarchy', 'section depth', 'section description', 'template', 'automation type', 'steps (step)', 'steps (expected result)', 'milestone', 'estimate', 'created by', 'created on', 'forecast'];

export function parseTestRail(file?: Express.Multer.File): unknown[][] {
  if (!file) throw new BadRequestException('Upload a TestRail XML or CSV export.');
  if (!/\.(xml|csv|xlsx)$/i.test(file.originalname)) throw new BadRequestException('TestRail import accepts .xml, .csv, and .xlsx exports.');
  try {
    const rows = /\.xml$/i.test(file.originalname) ? fromXml(file.buffer.toString('utf8')) : fromWorkbook(file);
    if (!rows.length || rows.length > 600) throw new BadRequestException('Use a TestRail export with between 1 and 600 cases.');
    if (JSON.stringify(rows).length > 500000) throw new BadRequestException('TestRail export text exceeds 500,000 characters.');
    return Array.from({ length: Math.ceil(rows.length / 30) }, (_, i) => rows.slice(i * 30, i * 30 + 30));
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException(e instanceof Error ? `Cannot read TestRail export: ${e.message}` : 'Cannot read TestRail export.');
  }
}

function fromXml(xml: string): unknown[] {
  const rows: unknown[] = [];
  collect(parseXml(xml.replace(/^\uFEFF/, '')), [], rows);
  if (!rows.length) throw new BadRequestException('No TestRail cases were found in this file.');
  return rows;
}

function fromWorkbook(file: Express.Multer.File): unknown[] {
  const book = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
  const cases: BuiltCase[] = [];
  let recognized = false;
  for (const name of book.SheetNames) {
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], { defval: '', raw: false }).map(normalizeRow);
    if (!table.length) continue;
    const headers = new Set(Object.keys(table[0]));
    if (!isTestRailSheet(headers, table)) continue;
    recognized = true;
    cases.push(...groupRows(table));
  }
  if (!recognized) throw new BadRequestException('This file does not look like a TestRail case export. Export a suite or section from TestRail, or use the spreadsheet upload for other workbooks.');
  return cases.map((item, index) => toSource(item, index));
}

function normalizeRow(row: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) out[normHeader(key)] = String(value ?? '');
  return out;
}
function isTestRailSheet(headers: Set<string>, table: Record<string, string>[]): boolean {
  if (!headers.has('title')) return false;
  if (distinctive.some(header => headers.has(header))) return true;
  const ids = table.map(row => cell(row, 'id')).filter(Boolean);
  return ids.length > 0 && ids.filter(id => /^C\d+$/i.test(id)).length >= Math.ceil(ids.length / 2);
}

function groupRows(table: Record<string, string>[]): BuiltCase[] {
  const cases: BuiltCase[] = [];
  let current: BuiltCase | undefined;
  for (const raw of table) {
    const id = cell(raw, 'id');
    const title = cell(raw, 'title');
    const step = cell(raw, 'steps (step)');
    const stepExpected = cell(raw, 'steps (expected result)');
    const continuation = current && !id && !title && !!(step || stepExpected);
    const sameCase = current && !!id && current.id === id;
    if (continuation || sameCase) {
      appendStep(current!, raw);
      continue;
    }
    if (current) cases.push(current);
    current = {
      id, title, section: cell(raw, 'section hierarchy') || cell(raw, 'section'), template: cell(raw, 'template'),
      type: cell(raw, 'type'), priority: cell(raw, 'priority'), preconditions: cell(raw, 'preconditions'),
      references: cell(raw, 'references') || cell(raw, 'refs'), steps: [], stepExpected: [],
      plainSteps: cell(raw, 'steps'), plainExpected: cell(raw, 'expected result'),
    };
    appendStep(current, raw);
  }
  if (current) cases.push(current);
  return cases.filter(item => item.title || item.id || item.plainSteps || item.steps.some(Boolean));
}

function appendStep(item: BuiltCase, raw: Record<string, string>) {
  const step = cell(raw, 'steps (step)');
  const expected = cell(raw, 'steps (expected result)');
  const notes = cell(raw, 'steps (additional info)');
  if (!step && !expected && !notes) return;
  item.steps.push([step, notes ? `Notes: ${notes}` : ''].filter(Boolean).join('\n'));
  item.stepExpected.push(expected);
}

export interface ApiCaseRecord {
  id: number; title?: string; section_id?: number; template_id?: number; type_id?: number; priority_id?: number; refs?: string;
  custom_preconds?: string | null; custom_steps?: string | null; custom_expected?: string | null;
  custom_steps_separated?: { content?: string | null; expected?: string | null; additional_info?: string | null }[] | null;
  custom_mission?: string | null; custom_goals?: string | null;
}
export interface ApiSection { id: number; name?: string; parent_id?: number | null }
export interface ApiLabels { priorities: Record<number, string>; types: Record<number, string>; templates: Record<number, string> }
export function chunkApiCases(cases: ApiCaseRecord[], sections: ApiSection[], labels: ApiLabels): unknown[][] {
  const paths = sectionPaths(sections);
  const rows = cases.map((item, index) => {
    const separated = Array.isArray(item.custom_steps_separated) ? item.custom_steps_separated : [];
    const notes = [item.custom_mission, item.custom_goals].map(value => htmlToText(value || '')).filter(Boolean).join('\n');
    const built: BuiltCase = {
      id: `C${item.id}`, title: htmlToText(item.title || ''), section: paths.get(item.section_id || 0) || '',
      template: labels.templates[item.template_id || 0] || '', type: labels.types[item.type_id || 0] || '', priority: labels.priorities[item.priority_id || 0] || '',
      preconditions: htmlToText(item.custom_preconds || ''), references: htmlToText(item.refs || ''),
      steps: separated.map(step => [htmlToText(step.content || ''), htmlToText(step.additional_info || '') ? `Notes: ${htmlToText(step.additional_info || '')}` : ''].filter(Boolean).join('\n')),
      stepExpected: separated.map(step => htmlToText(step.expected || '')),
      plainSteps: separated.length ? '' : [htmlToText(item.custom_steps || ''), notes].filter(Boolean).join('\n'),
      plainExpected: separated.length ? '' : htmlToText(item.custom_expected || ''),
    };
    return toSource(built, index);
  });
  if (!rows.length || rows.length > 600) throw new BadRequestException('Select between 1 and 600 TestRail cases.');
  if (JSON.stringify(rows).length > 500000) throw new BadRequestException('The selected TestRail cases exceed 500,000 characters.');
  return Array.from({ length: Math.ceil(rows.length / 30) }, (_, i) => rows.slice(i * 30, i * 30 + 30));
}
function sectionPaths(sections: ApiSection[]) {
  const byId = new Map(sections.map(section => [section.id, section]));
  const path = new Map<number, string>();
  for (const section of sections) {
    const names: string[] = [];
    const seen = new Set<number>();
    let current: ApiSection | undefined = section;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.name) names.unshift(current.name);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    path.set(section.id, names.join(' / '));
  }
  return path;
}
function toSource(item: BuiltCase, index: number) {
  const separated = item.steps.some(Boolean) || item.stepExpected.some(Boolean);
  const steps = separated
    ? item.steps.map((step, i) => [`${i + 1}. ${step || 'Step'}`, item.stepExpected[i] ? `Expected: ${item.stepExpected[i]}` : ''].filter(Boolean).join('\n')).join('\n')
    : item.plainSteps;
  const row: Record<string, string> = {};
  const put = (key: string, value: string) => { if (value.trim()) row[key] = value.trim(); };
  put('id', item.id); put('title', item.title || 'Untitled TestRail case'); put('section', item.section);
  put('template', item.template); put('type', item.type); put('priority', item.priority);
  put('preconditions', item.preconditions); put('steps', steps); put('expectedResult', separated ? '' : item.plainExpected);
  put('references', item.references);
  const sourceRef = `TestRail ${item.id || `case ${index + 1}`}${item.section ? ` · ${item.section}` : ''}`;
  return JSON.parse(mask(JSON.stringify({ sourceRef, row })));
}

function cell(row: Record<string, string>, header: string) { return htmlToText(row[header] ?? ''); }
function normHeader(header: string) { return header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' '); }

function collect(node: XmlNode, path: string[], out: unknown[]) {
  if (node.name === 'suite' || node.name === 'section') {
    const name = ownText(node, 'name');
    const next = name ? [...path, name] : path;
    for (const child of node.children) collect(child, next, out);
    return;
  }
  if (node.name === 'case') {
    out.push(caseFromXml(node, path, out.length));
    return;
  }
  for (const child of node.children) collect(child, path, out);
}

function caseFromXml(node: XmlNode, path: string[], index: number) {
  const steps = node.children.flatMap(child => descendants(child, 'step'));
  const separated = steps.map((step, i) => {
    const content = ownText(step, 'content');
    const expected = ownText(step, 'expected');
    const notes = ownText(step, 'additional_info');
    return [`${i + 1}. ${[content, notes ? `Notes: ${notes}` : ''].filter(Boolean).join('\n') || 'Step'}`, expected ? `Expected: ${expected}` : ''].filter(Boolean).join('\n');
  }).join('\n');
  const item: BuiltCase = {
    id: ownText(node, 'id'), title: ownText(node, 'title'), section: path.join(' / '), template: ownText(node, 'template'),
    type: ownText(node, 'type'), priority: ownText(node, 'priority'), preconditions: textOf(node, 'preconds') || textOf(node, 'preconditions'),
    references: textOf(node, 'references') || textOf(node, 'refs'), steps: [], stepExpected: [],
    plainSteps: separated || textOf(node, 'steps'), plainExpected: separated ? '' : (textOf(node, 'expected') || textOf(node, 'expected_result')),
  };
  return toSource(item, index);
}

function ownText(node: XmlNode, name: string) {
  const child = node.children.find(item => item.name === name);
  return child ? htmlToText(allText(child)) : '';
}
function textOf(node: XmlNode, name: string) {
  const found = descendants(node, name)[0];
  return found ? htmlToText(allText(found)) : '';
}
function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const child of node.children) {
    if (child.name === name) found.push(child);
    else found.push(...descendants(child, name));
  }
  return found;
}
function allText(node: XmlNode): string {
  if (node.name === '#text') return node.text;
  if (node.name === 'br') return '\n';
  let text = '';
  for (const child of node.children) text += allText(child) + (blocks.has(child.name) ? '\n' : '');
  return text;
}
function htmlToText(value: string) {
  const decoded = decode(value).replace(/\r\n/g, '\n');
  const plain = /<[a-z!/]/i.test(decoded)
    ? decoded.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<[^>]+>/g, '')
    : decoded;
  return plain.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function decode(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function tagName(raw: string) { const name = raw.toLowerCase(); const index = name.lastIndexOf(':'); return index >= 0 ? name.slice(index + 1) : name; }
function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', children: [], text: '' };
  const stack = [root];
  const tokens = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z0-9_:-]+)\s*>|<([A-Za-z0-9_:-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    if (match[1] !== undefined) { stack.at(-1)!.children.push({ name: '#text', children: [], text: match[1] }); continue; }
    if (match[2]) {
      const name = tagName(match[2]);
      while (stack.length > 1 && stack.at(-1)!.name !== name) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (match[3]) {
      const node = { name: tagName(match[3]), children: [], text: '' };
      stack.at(-1)!.children.push(node);
      if (!match[5]) stack.push(node);
      continue;
    }
    if (match[6]) stack.at(-1)!.children.push({ name: '#text', children: [], text: decode(match[6]) });
  }
  return root;
}
