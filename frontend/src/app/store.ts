import {computed,inject,Injectable,signal} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {Api} from './api';
import {FeatureMap,Progress,Suggestion,TestCase} from './models';
@Injectable({providedIn:'root'})
export class Store {
  private api=inject(Api);
  readonly session=signal('');readonly cases=signal<TestCase[]>([]);readonly map=signal<FeatureMap>({features:[]});readonly suggestions=signal<Suggestion[]>([]);
  readonly selected=signal(new Set<string>());readonly busy=signal('');readonly error=signal('');readonly progress=signal<Progress|null>(null);
  readonly selectedCases=computed(()=>this.suggestions().filter(s=>this.selected().has(s.id)));
  async run(label:string,action:()=>Promise<void>){if(this.busy())return;this.busy.set(label);this.error.set('');try{await action();}catch(e){let message=e instanceof Error?e.message:'Something went wrong. Please try again.';if(e instanceof HttpErrorResponse){if(e.error instanceof Blob){try{message=JSON.parse(await e.error.text()).message;}catch{message='Excel export failed. Please try again.';}}else message=e.error?.message || (e.status===0?'Cannot reach the API. Start the backend and try again.':message);}this.error.set(message);}finally{this.busy.set('');}}
  async upload(file:File|null,text:string){let body:FormData|{text:string};if(file){body=new FormData();body.append('file',file);}else body={text};this.remember(await this.api.upload(body));}
  async uploadTestRail(file:File){const body=new FormData();body.append('file',file);this.remember(await this.api.uploadTestRail(body));}
  async importTestRail(projectId:number,suiteId:number|null,caseIds:number[]){this.remember(await this.api.importTestRail({projectId,suiteId:suiteId??undefined,caseIds}));}
  private remember(result:{sessionId:string;testCases:TestCase[]}){this.session.set(result.sessionId);this.cases.set(result.testCases);this.map.set({features:[]});this.suggestions.set([]);this.selected.set(new Set());}
  async buildMap(){this.map.set(await this.api.map(this.session()));}
  rename(id:string,name:string){this.map.update(m=>({features:m.features.map(f=>f.id===id?{...f,name}:f)}));this.suggestions.set([]);this.selected.set(new Set());}
  move(caseId:string,featureId:string){this.map.update(m=>({features:m.features.map(f=>({...f,testCaseIds:[...f.testCaseIds.filter(id=>id!==caseId),...(f.id===featureId?[caseId]:[])]}))}));this.suggestions.set([]);this.selected.set(new Set());}
  async generate(){await this.api.save(this.session(),this.map());this.progress.set({completed:0,total:this.map().features.length,current:'Starting',status:'running'});await this.api.edges(this.session());for(;;){const p=await this.api.progress(this.session());this.progress.set(p);if(p.status==='complete'){this.suggestions.set(p.suggestions ?? []);this.selected.set(new Set());return;}if(p.status==='failed')throw new Error(p.error || 'Edge-case generation failed. Try again.');await new Promise(resolve=>setTimeout(resolve,1000));}}
  toggle(id:string,checked:boolean){this.selected.update(ids=>{const next=new Set(ids);checked?next.add(id):next.delete(id);return next;});}
  high(){this.selected.set(new Set(this.suggestions().filter(s=>s.priority==='high').map(s=>s.id)));}
  async download(){const blob=await this.api.export(this.session(),[...this.selected()]);const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='maryada-edge-cases.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
