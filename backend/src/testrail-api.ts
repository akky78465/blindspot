import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ApiCaseRecord, ApiLabels, ApiSection, chunkApiCases } from './testrail';

const exec = promisify(execFile);
const listCap = 800;

@Injectable()
export class TestRailClient {
  private labelCache = new Map<number, Promise<ApiLabels>>();
  projects() { return this.collect('get_projects', 'projects', 2000).then(page => page.items.map(item => ({ id: item.id, name: String(item.name || `Project ${item.id}`), suiteMode: Number(item.suite_mode || 1) }))); }
  async suites(projectId: number) {
    const page = await this.get(`get_suites/${this.id(projectId, 'project')}`, true);
    if (!page) return [];
    return this.items(page, 'suites').map(item => ({ id: item.id, name: String(item.name || `Suite ${item.id}`) }));
  }
  async catalog(projectId: number, suiteId?: number, sectionId?: number) {
    const project = this.id(projectId, 'project');
    const suite = this.optionalId(suiteId);
    const section = this.optionalId(sectionId);
    let path = `get_cases/${project}`;
    if (suite) path += `&suite_id=${suite}`;
    if (section) path += `&section_id=${section}`;
    const [casePage, sections] = await Promise.all([
      this.collect(path, 'cases', listCap),
      this.collect(`get_sections/${project}${suite ? `&suite_id=${suite}` : ''}`, 'sections', 2000),
    ]);
    const labels = await this.labels(project);
    const sectionItems = sections.items as ApiSection[];
    const paths = new Map(chunkPreview(sectionItems));
    return {
      total: casePage.total,
      truncated: casePage.truncated,
      sections: sectionItems.map(item => ({ id: item.id, name: paths.get(item.id) || item.name || `Section ${item.id}` })),
      cases: (casePage.items as ApiCaseRecord[]).map(item => ({
        id: item.id,
        title: String(item.title || 'Untitled TestRail case'),
        section: paths.get(item.section_id || 0) || '',
        priority: labels.priorities[item.priority_id || 0] || '',
        type: labels.types[item.type_id || 0] || '',
      })),
    };
  }
  async selection(projectId: number, suiteId: number | undefined, caseIds: number[]) {
    const ids = [...new Set(caseIds)];
    if (!ids.length || ids.some(id => !Number.isInteger(id) || id <= 0) || ids.length > 600) throw new BadRequestException('Select between 1 and 600 TestRail cases.');
    const project = this.id(projectId, 'project');
    const suite = this.optionalId(suiteId);
    const [labels, sections, cases] = await Promise.all([
      this.labels(project),
      this.collect(`get_sections/${project}${suite ? `&suite_id=${suite}` : ''}`, 'sections', 2000).then(page => page.items as ApiSection[]),
      this.pool(ids, id => this.get(`get_case/${id}`) as Promise<ApiCaseRecord & { suite_id?: number }>),
    ]);
    if (suite && cases.some(item => item.suite_id && item.suite_id !== suite)) throw new BadRequestException('Choose cases from the selected TestRail suite.');
    return chunkApiCases(cases, sections, labels);
  }
  private labels(projectId: number): Promise<ApiLabels> {
    let cached = this.labelCache.get(projectId);
    if (!cached) {
      cached = Promise.all([
        this.names('get_priorities', 'priorities'),
        this.names('get_case_types', 'case_types'),
        this.names(`get_templates/${projectId}`, 'templates'),
      ]).then(([priorities, types, templates]) => ({ priorities, types, templates }));
      this.labelCache.set(projectId, cached);
    }
    return cached;
  }
  private async names(path: string, key: string) {
    const page = await this.get(path);
    return Object.fromEntries(this.items(page, key).map(item => [item.id, String(item.name || item.id)]));
  }
  private async collect(path: string, key: string, cap: number) {
    const items: Record<string, any>[] = [];
    const seen = new Set<number>();
    let offset = 0;
    let truncated = false;
    while (items.length < cap) {
      const page = await this.get(`${path}&limit=250&offset=${offset}`);
      const batch = this.items(page, key);
      let added = 0;
      for (const item of batch) {
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
        added++;
        if (items.length >= cap) break;
      }
      const more = Array.isArray(page) ? batch.length === 250 : Boolean(page?._links?.next);
      truncated = items.length >= cap && more;
      if (!added || !more || truncated) break;
      offset += batch.length;
    }
    return { items: items.slice(0, cap), total: items.length, truncated };
  }
  private items(page: any, key: string): Record<string, any>[] {
    if (Array.isArray(page)) return page;
    const value = page?.[key];
    return Array.isArray(value) ? value : [];
  }
  private async pool<T>(ids: number[], worker: (id: number) => Promise<T>) {
    const results = new Array<T>(ids.length);
    let next = 0;
    const run = async () => { while (next < ids.length) { const index = next++; results[index] = await worker(ids[index]); } };
    await Promise.all(Array.from({ length: Math.min(5, ids.length) }, run));
    return results;
  }
  private id(value: number, label: string) {
    if (!Number.isInteger(value) || value <= 0) throw new BadRequestException(`Choose a valid TestRail ${label}.`);
    return value;
  }
  private optionalId(value?: number) { return value == null ? undefined : this.id(value, 'selection'); }
  private async get(path: string, optional = false): Promise<any> {
    const base = (process.env.TESTRAIL_URL || '').replace(/\/$/, '');
    const user = process.env.Testrail_Username || process.env.TESTRAIL_USERNAME || '';
    const password = process.env.Testrail_Password || process.env.TESTRAIL_PASSWORD || '';
    if (!base || !user || !password) throw new BadRequestException('TestRail is not configured on the server.');
    const args = ['--silent', '--show-error', '-w', '\n%{http_code}', '-H', `Authorization: Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, '-H', 'Accept: application/json', `${base}/index.php?/api/v2/${path}`];
    if (process.platform === 'win32') args.unshift('--ssl-no-revoke');
    let stdout = '';
    try {
      const result = await exec(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      stdout = result.stdout;
    } catch (error) {
      stdout = (error as { stdout?: string }).stdout || '';
      if (!stdout) throw new BadGatewayException('Could not reach TestRail from this machine.');
    }
    const text = stdout.replace(/\r/g, '');
    const split = text.lastIndexOf('\n');
    const status = Number(text.slice(split + 1));
    const body = text.slice(0, split);
    let parsed: any = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { error: 'TestRail returned an unexpected response.' }; }
    if (status === 400 && optional) return null;
    if (status === 401 || status === 403) throw new BadRequestException('TestRail rejected the configured username or password.');
    if (status >= 400 || !status) throw new BadGatewayException(parsed?.error || 'TestRail could not return the requested cases.');
    return parsed;
  }
}

function chunkPreview(sections: ApiSection[]) {
  const byId = new Map(sections.map(section => [section.id, section]));
  return sections.map(section => {
    const names: string[] = [];
    const seen = new Set<number>();
    let current: ApiSection | undefined = section;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.name) names.unshift(current.name);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return [section.id, names.join(' / ')] as const;
  });
}
