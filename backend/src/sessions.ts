import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LlmRouter } from './llm/router';
import { newTotals, recordUsage, Role, Usage, UsageTotals } from './llm/types';
import { normalizeRow } from './normalizer';
import { suggestionsSchema, featureMapSchema, normalizedSchema, TestCase, FeatureMap, Suggestion } from './schemas';
import { parseUpload } from './upload';
import { edgeCap, edgesPrompt } from './prompts/edges';
import { featuresPrompt } from './prompts/features';
import { normalizePrompt } from './prompts/normalize';
export interface Session {testCases:TestCase[]; featureMap?:FeatureMap; suggestions:Suggestion[]; busy:boolean; progress:{completed:number;total:number;current:string;status:string;error:string};created:number; usage:UsageTotals}
@Injectable()
export class Sessions {
  readonly sessions = new Map<string,Session>();
  constructor(private readonly llm:LlmRouter) {}
  get(id:string) {const s=this.sessions.get(id);if(!s) throw new NotFoundException('Session not found. Upload your cases again.');return s;}
  async mapFeatures(id:string) {
    const session=this.get(id);
    if(session.busy) throw new ConflictException('An analysis is already running.');
    session.busy=true;
    try {const map=await this.llm.structured('map',featureMapSchema,featuresPrompt(session.testCases),(r,u)=>recordUsage(session.usage,r,u));return this.saveMap(id,map,true);}
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
    session.featureMap=map;session.suggestions=[];return map;
  }
  beginEdges(id:string) {
    const session=this.get(id);
    if(session.busy) throw new ConflictException('An analysis is already running.');
    if(!session.featureMap) throw new BadRequestException('Create the feature map first.');
    void this.edges(id).catch(()=>undefined);
    return {started:true};
  }
  async edges(id:string) {
    const session=this.get(id);
    if(session.busy) throw new ConflictException('An analysis is already running.');
    if(!session.featureMap) throw new BadRequestException('Create the feature map first.');
    session.busy=true;
    session.progress={completed:0,total:session.featureMap.features.length,current:'',status:'running',error:''};
    const features=session.featureMap.features;
    const results:Suggestion[][]=new Array(features.length);
    const running=new Set<string>();
    const limit=Math.max(1,Number(process.env.EDGE_CONCURRENCY)||4);
    let next=0,failed=false;
    const worker=async()=>{
      while(!failed && next<features.length){
        const index=next++;const feature=features[index];
        running.add(feature.name);session.progress.current=[...running].join(', ');
        try {
          const cases=session.testCases.filter(c=>feature.testCaseIds.includes(c.id));
          const result=await this.llm.structured('edges',suggestionsSchema,edgesPrompt(feature,cases),(r,u)=>recordUsage(session.usage,r,u));
          const seen=new Set(cases.map(c=>c.title.trim().toLowerCase()));
          const covered=new Set<string>(feature.coveredCategories);
          // Local gate: drop duplicate titles and already-covered categories ("domain" is exempt because the prompt asks for extra domain gaps).
          results[index]=result.suggestions.filter(s=>{const title=s.title.trim().toLowerCase();if(seen.has(title)) return false;if(s.category!=='domain' && covered.has(s.category)) return false;seen.add(title);return true;})
            .slice(0,edgeCap(feature)).map(s=>({...s,featureId:feature.id}));
          session.progress.completed++;
        } catch(error){failed=true;throw error;}
        finally {running.delete(feature.name);session.progress.current=[...running].join(', ');}
      }
    };
    try {
      await Promise.all(Array.from({length:Math.min(limit,features.length)},worker));
      // IDs are assigned in feature order after all calls finish, so output is identical to sequential generation.
      const suggestions=results.flat().map((s,i)=>({...s,id:`EC-${String(i+1).padStart(3,'0')}`}));
      const ranks={high:0,medium:1,low:2};
      session.suggestions=suggestions.sort((a,b)=>ranks[a.priority]-ranks[b.priority]);
      session.progress.status='complete';return {suggestions:session.suggestions};
    } catch(error){session.progress.status='failed';session.progress.error=error instanceof Error?error.message:'Edge-case generation failed.';throw error;} finally{session.busy=false;}
  }
  async upload(file?:Express.Multer.File,text?:unknown) {
    const items=parseUpload(file,text).flat(); const cases:TestCase[]=[]; const usage=newTotals();
    const sink=(role:Role,u:Usage)=>recordUsage(usage,role,u);
    // Rows that already look like test cases are mapped in code; only the rest pay for a model call, in 30-item chunks.
    let pending:unknown[]=[];
    const flush=async()=>{
      for(let i=0;i<pending.length;i+=30){const result=await this.llm.structured('normalize',normalizedSchema,normalizePrompt(pending.slice(i,i+30)),sink);cases.push(...result.testCases);}
      pending=[];
    };
    for(const item of items){const direct=normalizeRow(item);if(direct){await flush();cases.push(direct);}else pending.push(item);}
    await flush();
    cases.forEach((c,i)=>c.id=`TC-${String(i+1).padStart(3,'0')}`);
    const sessionId=randomUUID();
    for(const [id,s] of this.sessions) if(!s.busy && Date.now()-s.created>4*3600000) this.sessions.delete(id);
    this.sessions.set(sessionId,{testCases:cases,suggestions:[],busy:false,progress:{completed:0,total:0,current:'',status:'idle',error:''},created:Date.now(),usage});
    return {sessionId,testCases:cases};
  }
}
