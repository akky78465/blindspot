import {afterNextRender,Injector,ChangeDetectionStrategy,Component,computed,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatStepperModule} from '@angular/material/stepper';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatChipsModule} from '@angular/material/chips';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {Store} from './store';
import {Api,RailListCase,RailProject,RailSection,RailSuite} from './api';
@Component({selector:'app-root',standalone:true,imports:[FormsModule,MatButtonModule,MatStepperModule,MatCheckboxModule,MatChipsModule,MatProgressBarModule],templateUrl:'./app.html',changeDetection:ChangeDetectionStrategy.OnPush})
export class App {
  private readonly injector=inject(Injector);
  private readonly api=inject(Api);
  readonly store=inject(Store);readonly file=signal<File|null>(null);readonly testrailFile=signal<File|null>(null);text='';readonly category=signal('all');readonly priority=signal('all');readonly stage=signal(0);readonly drag=signal(false);
  readonly railOpen=signal(false);readonly projectQuery=signal('');readonly caseQuery=signal('');
  readonly railProjects=signal<RailProject[]>([]);readonly railSuites=signal<RailSuite[]>([]);readonly railSections=signal<RailSection[]>([]);readonly railCases=signal<RailListCase[]>([]);
  readonly railSelected=signal(new Set<number>());readonly railProject=signal<number|null>(null);readonly railSuite=signal<number|null>(null);readonly railSection=signal<number|null>(null);readonly railNotice=signal('');
  readonly filteredProjects=computed(()=>{const query=this.projectQuery().trim().toLowerCase();const projects=this.railProjects();const matched=projects.filter(project=>!query||project.name.toLowerCase().includes(query));const selected=projects.find(project=>project.id===this.railProject());return selected&&!matched.some(project=>project.id===selected.id)?[selected,...matched]:matched;});
  readonly filteredCases=computed(()=>{const query=this.caseQuery().trim().toLowerCase();return this.railCases().filter(item=>!query||item.title.toLowerCase().includes(query)||`c${item.id}`.includes(query)||item.section.toLowerCase().includes(query));});
  readonly categories=computed(()=>[...new Set(this.store.suggestions().map(s=>s.category))]);
  readonly visible=computed(()=>this.store.suggestions().filter(s=>(this.category()==='all'||s.category===this.category())&&(this.priority()==='all'||s.priority===this.priority())));
  readonly groups=computed(()=>this.store.map().features.map(f=>({...f,items:this.visible().filter(s=>s.featureId===f.id)})).filter(f=>f.items.length));
  newSet(){return new Set<string>();}
  newNumberSet(){return new Set<number>();}
  openTestRail(){this.railOpen.set(true);if(this.railProjects().length)return;void this.store.run('Loading TestRail',async()=>{this.railProjects.set(await this.apiProjects());});}
  chooseProject(value:string){const id=Number(value);this.railProject.set(Number.isInteger(id)&&id>0?id:null);this.railSuite.set(null);this.railSection.set(null);this.railSuites.set([]);this.railSections.set([]);this.railCases.set([]);this.railSelected.set(new Set());this.railNotice.set('');if(!this.railProject())return;void this.store.run('Loading TestRail suites',async()=>{const suites=await this.api.testrailSuites(id);this.railSuites.set(suites);if(!suites.length)await this.fetchCases();});}
  chooseSuite(value:string){const id=Number(value);this.railSuite.set(Number.isInteger(id)&&id>0?id:null);this.railSection.set(null);this.railCases.set([]);this.railSelected.set(new Set());this.railNotice.set('');if(!this.railSuite())return;void this.store.run('Loading TestRail cases',()=>this.fetchCases());}
  chooseSection(value:string){const id=Number(value);this.railSection.set(Number.isInteger(id)&&id>0?id:null);this.railSelected.set(new Set());void this.store.run('Loading TestRail cases',()=>this.fetchCases());}
  toggleRail(id:number,checked:boolean){this.railSelected.update(ids=>{const next=new Set(ids);checked?next.add(id):next.delete(id);return next;});}
  selectShown(){this.railSelected.update(ids=>{const next=new Set(ids);for(const item of this.filteredCases())next.add(item.id);return next;});}
  importTestRail(){const projectId=this.railProject();if(!projectId||!this.railSelected().size)return;void this.store.run('Understanding your TestRail cases',()=>this.store.importTestRail(projectId,this.railSuite(),[...this.railSelected()]));}
  private apiProjects(){return this.api.testrailProjects();}
  private async fetchCases(){const projectId=this.railProject();if(!projectId)return;const catalog=await this.api.testrailCases(projectId,this.railSuite(),this.railSection());this.railSections.set(catalog.sections);this.railCases.set(catalog.cases);this.caseQuery.set('');this.railNotice.set(catalog.truncated?'Showing the first 800 cases. Choose a section to narrow the list.':'');}
  choose(file:File|undefined){if(!file)return;if(!/\.(xlsx|csv)$/i.test(file.name)||file.size>5*1024*1024){this.store.error.set('Choose an .xlsx or .csv file up to 5 MB.');return;}this.file.set(file);this.text='';this.store.error.set('');}
  pick(event:Event){const target=event.target;if(target instanceof HTMLInputElement)this.choose(target.files?.[0]);}
  drop(event:DragEvent){event.preventDefault();this.drag.set(false);if(!this.store.busy())this.choose(event.dataTransfer?.files[0]);}
  upload(){void this.store.run('Understanding your test cases',()=>this.store.upload(this.file(),this.text));}
  chooseTestRail(file:File|undefined){if(!file)return;if(!/\.(xml|csv|xlsx)$/i.test(file.name)||file.size>5*1024*1024){this.store.error.set('Choose a TestRail .xml, .csv, or .xlsx export up to 5 MB.');return;}this.testrailFile.set(file);this.store.error.set('');}
  pickTestRail(event:Event){const target=event.target;if(target instanceof HTMLInputElement)this.chooseTestRail(target.files?.[0]);}
  uploadTestRail(){const file=this.testrailFile();if(!file)return;void this.store.run('Understanding your TestRail cases',()=>this.store.uploadTestRail(file));}
  featureMap(){void this.store.run('Mapping features and coverage',async()=>{await this.store.buildMap();afterNextRender(()=>this.stage.set(1),{injector:this.injector});});}
  edges(){void this.store.run('Finding missing edge cases',async()=>{await this.store.generate();afterNextRender(()=>this.stage.set(2),{injector:this.injector});});}
  download(){void this.store.run('Preparing your Excel workbook',()=>this.store.download());}
  featureFor(id:string){return this.store.map().features.find(f=>f.testCaseIds.includes(id))?.id ?? '';}
}
