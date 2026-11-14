import { TestCase } from './schemas';

/** Header aliases (compared after lowercasing and stripping punctuation). */
const ALIASES = {
  title:['title','test case title','test case','test case name','test name','name','scenario','summary','case title'],
  feature:['feature','module','area','component'],
  preconditions:['preconditions','precondition','prerequisites','prerequisite'],
  steps:['steps','test steps','step','procedure','actions'],
  inputs:['inputs','input','test data','input data','data'],
  expected:['expected result','expected results','expected','expected outcome','expected behavior','expected behaviour'],
  priority:['priority','severity'],
  type:['type','test type','case type','positive negative'],
} as const;
type Column = keyof typeof ALIASES;
type Columns = Partial<Record<Column,string>>;

const key = (h:string) => h.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

/** Maps a row's headers to test-case columns, or null if it is not a test-case table. */
export function detectColumns(headers:string[]): Columns | null {
  const cols:Columns = {};
  for (const [col,names] of Object.entries(ALIASES) as [Column,readonly string[]][]) {
    const found = headers.find(h=>names.includes(key(h)));
    if (found) cols[col]=found;
  }
  return cols.title && (cols.steps || cols.expected) ? cols : null;
}

const cell = (v:unknown) => typeof v==='string' ? v.trim() : v==null ? '' : String(v).trim();
function list(value:string): string[] {
  let parts = value.split(/\r?\n/);
  if (parts.length===1) parts = value.split(';');
  return parts.map(p=>p.replace(/^\s*(?:\d+[.)]|[-*•])\s*/,'').trim()).filter(Boolean);
}
function inputs(value:string): TestCase['inputs'] {
  return list(value).flatMap(p=>{const m=p.match(/^([^:=]+?)\s*[:=]\s*(.*)$/);return m ? [{field:m[1].trim(),value:m[2].trim()}] : [];});
}
function priority(value:string): TestCase['priority'] {
  const v=value.toLowerCase();
  if (/high|critical|blocker|\bp[01]\b/.test(v)) return 'high';
  if (/med|normal|\bp2\b/.test(v)) return 'medium';
  if (/low|minor|trivial|\bp3\b/.test(v)) return 'low';
  return undefined;
}
const NEGATIVE = /\b(invalid|reject(s|ed)?|error|fail(s|ed|ure)?|denied|unauthori[sz]ed|not allowed|cannot|blocked|empty|missing|wrong|incorrect|expired)\b/i;

/**
 * Converts one uploaded row to a test case without a model. Returns null when the
 * row's headers are not a test-case table or the title is empty (the model handles it instead).
 */
export function normalizeRow(item:unknown): TestCase | null {
  const {sourceRef,row} = item as {sourceRef?:unknown; row?:Record<string,unknown>};
  if (typeof sourceRef!=='string' || !row || typeof row!=='object') return null;
  const cols = detectColumns(Object.keys(row));
  if (!cols) return null;
  const get = (c:Column) => cols[c] ? cell(row[cols[c]!]) : '';
  const title = get('title');
  if (!title) return null;
  const expectedResult = get('expected');
  const typeText = get('type');
  const type:TestCase['type'] = typeText ? (/neg|invalid|fail/i.test(typeText) ? 'negative' : 'positive') : NEGATIVE.test(`${title} ${expectedResult}`) ? 'negative' : 'positive';
  const out:TestCase = {id:'',title,preconditions:list(get('preconditions')),steps:list(get('steps')),inputs:inputs(get('inputs')),expectedResult,type,sourceRef};
  const feature = get('feature'); if (feature) out.feature = feature;
  const p = priority(get('priority')); if (p) out.priority = p;
  return out;
}
