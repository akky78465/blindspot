import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {ExportFormat,FeatureMap,Progress,TestCase} from './models';
export interface RailProject {id:number;name:string;suiteMode:number}
export interface RailSuite {id:number;name:string}
export interface RailSection {id:number;name:string}
export interface RailListCase {id:number;title:string;section:string;priority:string;type:string}
export interface RailCatalog {sections:RailSection[];cases:RailListCase[];total:number;truncated:boolean}
@Injectable({providedIn:'root'})
export class Api {
  private http=inject(HttpClient);
  upload(body:FormData|{text:string}){return firstValueFrom(this.http.post<{sessionId:string;testCases:TestCase[]}>('/api/sessions/upload',body));}
  uploadTestRail(body:FormData){return firstValueFrom(this.http.post<{sessionId:string;testCases:TestCase[]}>('/api/sessions/testrail',body));}
  testrailProjects(){return firstValueFrom(this.http.get<RailProject[]>('/api/testrail/projects'));}
  testrailSuites(projectId:number){return firstValueFrom(this.http.get<RailSuite[]>(`/api/testrail/projects/${projectId}/suites`));}
  testrailCases(projectId:number,suiteId?:number|null,sectionId?:number|null){const params=new URLSearchParams();if(suiteId)params.set('suiteId',String(suiteId));if(sectionId)params.set('sectionId',String(sectionId));const query=params.toString();return firstValueFrom(this.http.get<RailCatalog>(`/api/testrail/projects/${projectId}/cases${query?`?${query}`:''}`));}
  importTestRail(body:{projectId:number;suiteId?:number;caseIds:number[]}){return firstValueFrom(this.http.post<{sessionId:string;testCases:TestCase[]}>('/api/testrail/import',body));}
  map(id:string){return firstValueFrom(this.http.post<FeatureMap>(`/api/sessions/${id}/feature-map`,{}));}
  save(id:string,map:FeatureMap){return firstValueFrom(this.http.put<FeatureMap>(`/api/sessions/${id}/feature-map`,map));}
  edges(id:string){return firstValueFrom(this.http.post<{started:boolean}>(`/api/sessions/${id}/edge-cases`,{}));}
  progress(id:string){return firstValueFrom(this.http.get<Progress>(`/api/sessions/${id}/progress`));}
  export(id:string,selectedIds:string[],format:ExportFormat='xlsx'){return firstValueFrom(this.http.post(`/api/sessions/${id}/export`,{selectedIds,format},{responseType:'blob'}));}
}
