import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ClaudeClient } from './claude';
import { suggestionsSchema, featureMapSchema, normalizedSchema, TestCase, FeatureMap, Suggestion } from './schemas';
import { parseUpload } from './upload';
import { edgesPrompt } from './prompts/edges';
import { featuresPrompt } from './prompts/features';
import { normalizePrompt } from './prompts/normalize';
export interface Session {testCases:TestCase[]; featureMap?:FeatureMap; suggestions:Suggestion[]; busy:boolean; progress:{completed:number;total:number;current:string;status:string;error:string};created:number}
@Injectable()
export class Sessions {
  readonly sessions = new Map<string,Session>();
  constructor(private readonly claude:ClaudeClient) {}
  get(id:string) {const s=this.sessions.get(id);if(!s) throw new NotFoundException('Session not found. Upload your cases again.');return s;}
  async mapFeatures(id:string) {
    const session=this.get(id);
    if(session.busy) throw new ConflictException('An analysis is already running.');
    session.busy=true;
    try {const map=await this.claude.structured(featureMapSchema,featuresPrompt(session.testCases));return this.saveMap(id,map,true);}
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
    const suggestions:Suggestion[]=[];
    try {
      for(const feature of session.featureMap.features) {
        session.progress.current=feature.name;
        const cases=session.testCases.filter(c=>feature.testCaseIds.includes(c.id));
        const result=await this.claude.structured(suggestionsSchema,edgesPrompt(feature,cases));
        const seen=new Set(cases.map(c=>c.title.trim().toLowerCase()));
        for(const suggestion of result.suggestions){
          const title=suggestion.title.trim().toLowerCase();
          if(seen.has(title)) continue;seen.add(title);
          suggestions.push({...suggestion,id:`EC-${String(suggestions.length+1).padStart(3,'0')}`,featureId:feature.id});
        }
        session.progress.completed++;
      }
      const ranks={high:0,medium:1,low:2};
      session.suggestions=suggestions.sort((a,b)=>ranks[a.priority]-ranks[b.priority]);
      session.progress.status='complete';return {suggestions:session.suggestions};
    } catch(error){session.progress.status='failed';session.progress.error=error instanceof Error?error.message:'Edge-case generation failed.';throw error;} finally{session.busy=false;}
  }
  async upload(file?:Express.Multer.File,text?:unknown) {
    const chunks=parseUpload(file,text); const cases:TestCase[]=[];
    for(const chunk of chunks) {const result=await this.claude.structured(normalizedSchema,normalizePrompt(chunk)); cases.push(...result.testCases);}
    cases.forEach((c,i)=>c.id=`TC-${String(i+1).padStart(3,'0')}`);
    const sessionId=randomUUID();
    for(const [id,s] of this.sessions) if(!s.busy && Date.now()-s.created>4*3600000) this.sessions.delete(id);
    this.sessions.set(sessionId,{testCases:cases,suggestions:[],busy:false,progress:{completed:0,total:0,current:'',status:'idle',error:''},created:Date.now()});
    return {sessionId,testCases:cases};
  }
}
