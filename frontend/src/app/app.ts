import {afterNextRender,Injector,ChangeDetectionStrategy,Component,computed,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatStepperModule} from '@angular/material/stepper';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatChipsModule} from '@angular/material/chips';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {Store} from './store';
@Component({selector:'app-root',standalone:true,imports:[FormsModule,MatButtonModule,MatStepperModule,MatCheckboxModule,MatChipsModule,MatProgressBarModule],templateUrl:'./app.html',changeDetection:ChangeDetectionStrategy.OnPush})
export class App {
  private readonly injector=inject(Injector);
  readonly store=inject(Store);readonly file=signal<File|null>(null);text='';readonly category=signal('all');readonly priority=signal('all');readonly stage=signal(0);readonly drag=signal(false);
  readonly categories=computed(()=>[...new Set(this.store.suggestions().map(s=>s.category))]);
  readonly visible=computed(()=>this.store.suggestions().filter(s=>(this.category()==='all'||s.category===this.category())&&(this.priority()==='all'||s.priority===this.priority())));
  readonly groups=computed(()=>this.store.map().features.map(f=>({...f,items:this.visible().filter(s=>s.featureId===f.id)})).filter(f=>f.items.length));
  newSet(){return new Set<string>();}
  choose(file:File|undefined){if(!file)return;if(!/\.(xlsx|csv)$/i.test(file.name)||file.size>5*1024*1024){this.store.error.set('Choose an .xlsx or .csv file up to 5 MB.');return;}this.file.set(file);this.text='';this.store.error.set('');}
  pick(event:Event){const target=event.target;if(target instanceof HTMLInputElement)this.choose(target.files?.[0]);}
  drop(event:DragEvent){event.preventDefault();this.drag.set(false);if(!this.store.busy())this.choose(event.dataTransfer?.files[0]);}
  upload(){void this.store.run('Understanding your test cases',()=>this.store.upload(this.file(),this.text));}
  featureMap(){void this.store.run('Mapping features and coverage',async()=>{await this.store.buildMap();afterNextRender(()=>this.stage.set(1),{injector:this.injector});});}
  edges(){void this.store.run('Finding missing edge cases',async()=>{await this.store.generate();afterNextRender(()=>this.stage.set(2),{injector:this.injector});});}
  download(){void this.store.run('Preparing your Excel workbook',()=>this.store.download());}
  featureFor(id:string){return this.store.map().features.find(f=>f.testCaseIds.includes(id))?.id ?? '';}
}
