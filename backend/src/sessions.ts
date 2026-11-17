import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { compose } from './agents/agent';
import { edgeCase } from './agents/edge-case';
import { featureMapper } from './agents/feature-mapper';
import { normalizer } from './agents/normalizer';
import { EdgeRunner } from './agents/runner';
import { ClaudeClient } from './claude';
import { featureMapSchema, TestCase, FeatureMap, Suggestion } from './schemas';
import { TestRailClient } from './testrail-api';
import { parseTestRail } from './testrail';
import { parseUpload } from './upload';
function assertAnalyzable(map:FeatureMap) {
  const chosen=map.features.filter(f=>f.selected);
  if(!chosen.length) throw new BadRequestException('Select at least one feature for edge-case analysis.');
  if(chosen.some(f=>!f.uncoveredCategories.length)) throw new BadRequestException('Each selected feature needs at least one gap. Mark a gap or uncheck the feature.');
}
export interface Session {testCases:TestCase[]; featureMap?:FeatureMap; suggestions:Suggestion[]; busy:boolean; progress:{completed:number;total:number;current:string;status:string;error:string;review:string};created:number}
@Injectable()
export class Sessions {
  readonly sessions = new Map<string,Session>();
  constructor(private readonly claude:ClaudeClient, private readonly edgesRunner:EdgeRunner, private readonly testrail?:TestRailClient) {}
  get(id:string) {const s=this.sessions.get(id);if(!s) throw new NotFoundException('Session not found. Upload your cases again.');return s;}
  async mapFeatures(id:string) {
    const session=this.get(id);
    if(session.busy) throw new ConflictException('An analysis is already running.');
    session.busy=true;
    try {const map=await this.claude.structured(featureMapper.output,compose(featureMapper,session.testCases));return this.saveMap(id,map,true);}
    finally {session.busy=false;}
  }
  saveMap(id:string,body:unknown,internal=false) {
    const session=this.get(id);
    if(session.busy && !internal) throw new ConflictException('Wait for the current analysis to finish.');
    const parsed=featureMapSchema.safeParse(body);
    if(!parsed.success) throw new BadRequestException('Invalid feature map.');
    const map=parsed.data;const ids=map.features.flatMap(f=>f.testCaseIds);
    if(new Set(map.features.map(f=>f.id)).size!==map.features.length || ids.length!==session.testCases.length || new Set(ids).size!==ids.length || ids.some(id=>!session.testCases.some(c=>c.id===id))) throw new BadRequestException('Each test case must belong to exactly one feature; feature IDs must be unique.');
    if(map.features.some(f=>new Set([...f.coveredCategories,...f.uncoveredCategories]).size!==11 || f.coveredCategories.some(c=>f.uncoveredCategories.includes(c)))) throw new BadRequestException('Feature coverage categories must be complete and disjoint.');
    if(!internal) assertAnalyzable(map);
    session.featureMap=map;session.suggestions=[];return map;
  }
  beginEdges(id:string) {
    const session=this.get(id);
    if(session.busy) throw new ConflictException('An analysis is already running.');
    if(!session.featureMap) throw new BadRequestException('Create the feature map first.');
    assertAnalyzable(session.featureMap);
    // Checked before busy is set, so a missing reviewer key returns 503 and does not start a background job.
    this.edgesRunner.prepare();
    void this.edges(id).catch(()=>undefined);
    return {started:true};
  }
  async edges(id:string) {
    const session=this.get(id);
    if(session.busy) throw new ConflictException('An analysis is already running.');
    if(!session.featureMap) throw new BadRequestException('Create the feature map first.');
    assertAnalyzable(session.featureMap);
    session.busy=true;
    const features=session.featureMap.features.filter(f=>f.selected);
    session.progress={completed:0,total:features.length,current:'',status:'running',error:'',review:''};
    const results:{suggestions:Suggestion[];notes:string[];review:string}[]=new Array(features.length);
    const running=new Set<string>();
    const limit=Math.max(1,Number(process.env.EDGE_CONCURRENCY)||4);
    let next=0,failed=false;
    const worker=async()=>{
      while(!failed && next<features.length){
        const index=next++;const feature=features[index];
        running.add(feature.name);session.progress.current=[...running].join(', ');
        try {
          const cases=session.testCases.filter(c=>feature.testCaseIds.includes(c.id));
          const outcome=await this.edgesRunner.run(edgeCase,{feature,cases});
          const seen=new Set(cases.map(c=>c.title.trim().toLowerCase()));
          // Out-of-gap categories are removed here, after the judge has already reviewed the draft.
          results[index]={notes:outcome.notes,review:outcome.review,suggestions:outcome.suggestions.filter(s=>feature.uncoveredCategories.includes(s.category)).filter(s=>{const title=s.title.trim().toLowerCase();if(seen.has(title)) return false;seen.add(title);return true;})
            .map(s=>({...s,featureId:feature.id}))};
          session.progress.completed++;
        } catch(error){failed=true;throw error;}
        finally {running.delete(feature.name);session.progress.current=[...running].join(', ');}
      }
    };
    try {
      await Promise.all(Array.from({length:Math.min(limit,features.length)},worker));
      // IDs are assigned in feature order after all calls finish, so output is identical to sequential generation.
      const notes=results.flatMap(result=>result.notes);
      session.progress.review=[results.map(result=>result.review).filter(Boolean).join('\n'), ...notes].filter(Boolean).join('\n');
      const suggestions=results.flatMap(result=>result.suggestions).map((s,i)=>({...s,id:`EC-${String(i+1).padStart(3,'0')}`}));
      const ranks={high:0,medium:1,low:2};
      session.suggestions=suggestions.sort((a,b)=>ranks[a.priority]-ranks[b.priority]);
      if(!session.suggestions.length){session.progress.status='failed';session.progress.error=notes.join('\n')||'No edge cases remained after review.';return {suggestions:session.suggestions};}
      session.progress.status='complete';session.progress.error='';return {suggestions:session.suggestions};
    } catch(error){session.progress.status='failed';session.progress.error=error instanceof Error?error.message:'Edge-case generation failed.';throw error;} finally{session.busy=false;}
  }
  async upload(file?:Express.Multer.File,text?:unknown) {
    return this.normalizeAndStore(parseUpload(file,text));
  }
  async uploadTestRail(file?:Express.Multer.File) {
    return this.normalizeAndStore(parseTestRail(file));
  }
  async importTestRail(body:unknown) {
    if(!this.testrail) throw new BadRequestException('TestRail is not configured on the server.');
    const value=body as {projectId?:unknown;suiteId?:unknown;caseIds?:unknown};
    const projectId=Number(value?.projectId);
    const suiteId=value?.suiteId==null || value.suiteId==='' ? undefined : Number(value.suiteId);
    const caseIds=Array.isArray(value?.caseIds) ? value.caseIds.map(Number) : [];
    return this.normalizeAndStore(await this.testrail.selection(projectId, suiteId, caseIds));
  }
  private async normalizeAndStore(chunks:unknown[][]) {
    const cases:TestCase[]=[];
    for(const chunk of chunks) {const result=await this.claude.structured(normalizer.output,compose(normalizer,chunk)); cases.push(...result.testCases);}
    cases.forEach((c,i)=>c.id=`TC-${String(i+1).padStart(3,'0')}`);
    const sessionId=randomUUID();
    for(const [id,s] of this.sessions) if(!s.busy && Date.now()-s.created>4*3600000) this.sessions.delete(id);
    this.sessions.set(sessionId,{testCases:cases,suggestions:[],busy:false,progress:{completed:0,total:0,current:'',status:'idle',error:'',review:''},created:Date.now()});
    return {sessionId,testCases:cases};
  }
}
