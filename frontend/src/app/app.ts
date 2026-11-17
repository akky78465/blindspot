import {afterNextRender,Injector,ChangeDetectionStrategy,Component,computed,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatStepperModule} from '@angular/material/stepper';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatChipsModule} from '@angular/material/chips';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {categories,ExportFormat} from './models';
import {Store} from './store';
@Component({selector:'app-root',standalone:true,imports:[FormsModule,MatButtonModule,MatStepperModule,MatCheckboxModule,MatChipsModule,MatProgressBarModule],templateUrl:'./app.html',changeDetection:ChangeDetectionStrategy.OnPush})
export class App {
  private readonly injector=inject(Injector);
  readonly store=inject(Store);readonly file=signal<File|null>(null);text='';readonly category=signal('all');readonly priority=signal('all');readonly format=signal<ExportFormat>('xlsx');readonly stage=signal(0);readonly drag=signal(false);readonly allCategories=categories;
  readonly exportFormats:{id:ExportFormat;label:string}[]=[{id:'xlsx',label:'Excel'},{id:'gherkin',label:'Gherkin'},{id:'playwright',label:'Playwright'}];
  readonly exportView=computed(()=>({
    xlsx:{blurb:'Your selected edge cases and generated synthetic data, together in one workbook.',button:'↓ Download Excel',busy:'Preparing your Excel workbook',items:[{title:'01 · Edge Cases',detail:'Steps, rationale, priority, and expected results'},{title:'02 · Test Data',detail:'Repeatable synthetic values for each input'},{title:'03 · Summary',detail:'Feature counts and inferred category coverage'}]},
    gherkin:{blurb:'Your selected edge cases as Cucumber scenarios, with synthetic values ready for the next run.',button:'↓ Download Gherkin',busy:'Preparing your Gherkin feature',items:[{title:'01 · Feature',detail:'One feature for each product area in the selection'},{title:'02 · Scenario',detail:'Given, When, and Then for every selected edge case'},{title:'03 · Examples',detail:'Synthetic values in a table when the case has data'}]},
    playwright:{blurb:'A Playwright skeleton with one test per case. Locators are left for your team to fill in.',button:'↓ Download Playwright',busy:'Preparing your Playwright spec',items:[{title:'01 · Spec',detail:'One test() for each selected edge case'},{title:'02 · Steps',detail:'Each action is a test.step ready to fill in'},{title:'03 · Data',detail:'Synthetic values in a const data block'}]},
  })[this.format()]);
  readonly categories=computed(()=>{const analyzed=new Set(this.store.map().features.filter(f=>f.selected).map(f=>f.id));return [...new Set(this.store.suggestions().filter(s=>analyzed.has(s.featureId)).map(s=>s.category))];});
  readonly visible=computed(()=>this.store.suggestions().filter(s=>(this.category()==='all'||s.category===this.category())&&(this.priority()==='all'||s.priority===this.priority())));
  readonly groups=computed(()=>this.store.map().features.filter(f=>f.selected).map(f=>({...f,items:this.visible().filter(s=>s.featureId===f.id)})).filter(f=>f.items.length));
  newSet(){return new Set<string>();}
  choose(file:File|undefined){if(!file)return;if(!/\.(xlsx|csv)$/i.test(file.name)||file.size>5*1024*1024){this.store.error.set('Choose an .xlsx or .csv file up to 5 MB.');return;}this.file.set(file);this.text='';this.store.error.set('');}
  pick(event:Event){const target=event.target;if(target instanceof HTMLInputElement)this.choose(target.files?.[0]);}
  drop(event:DragEvent){event.preventDefault();this.drag.set(false);if(!this.store.busy())this.choose(event.dataTransfer?.files[0]);}
  upload(){void this.store.run('Understanding your test cases',()=>this.store.upload(this.file(),this.text));}
  featureMap(){void this.store.run('Mapping features and coverage',async()=>{await this.store.buildMap();afterNextRender(()=>this.stage.set(1),{injector:this.injector});});}
  edges(){void this.store.run('Finding missing edge cases',async()=>{await this.store.generate();afterNextRender(()=>this.stage.set(2),{injector:this.injector});});}
  download(){void this.store.run(this.exportView().busy,()=>this.store.download(this.format()));}
  featureFor(id:string){return this.store.map().features.find(f=>f.testCaseIds.includes(id))?.id ?? '';}
}
