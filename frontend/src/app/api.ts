import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {FeatureMap,Progress,Suggestion,TestCase} from './models';
@Injectable({providedIn:'root'})
export class Api {
  private http=inject(HttpClient);
  upload(body:FormData|{text:string}){return firstValueFrom(this.http.post<{sessionId:string;testCases:TestCase[]}>('/api/sessions/upload',body));}
  map(id:string){return firstValueFrom(this.http.post<FeatureMap>(`/api/sessions/${id}/feature-map`,{}));}
  save(id:string,map:FeatureMap){return firstValueFrom(this.http.put<FeatureMap>(`/api/sessions/${id}/feature-map`,map));}
  edges(id:string){return firstValueFrom(this.http.post<{suggestions:Suggestion[]}>(`/api/sessions/${id}/edge-cases`,{}));}
  progress(id:string){return firstValueFrom(this.http.get<Progress>(`/api/sessions/${id}/progress`));}
  export(id:string,selectedIds:string[]){return firstValueFrom(this.http.post(`/api/sessions/${id}/export`,{selectedIds},{responseType:'blob'}));}
}
