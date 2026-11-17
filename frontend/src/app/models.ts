export const categories = ['boundary','null_empty','format','length','special_chars','date_time','state_transition','permissions','concurrency','security','domain'] as const;
export type ExportFormat = 'xlsx' | 'gherkin' | 'playwright';
export interface TestCase {id:string;title:string;feature?:string;sourceRef:string;type:string;expectedResult:string;steps:string[]}
export interface Feature {id:string;name:string;description:string;fields:{name:string;inferredType:string;inferredConstraints:string[]}[];rules:string[];flows:string[];testCaseIds:string[];coveredCategories:string[];uncoveredCategories:string[];selected:boolean}
export interface FeatureMap {features:Feature[]}
export interface Suggestion {id:string;featureId:string;title:string;category:string;priority:string;rationale:string;preconditions:string[];steps:string[];expectedResult:string;dataSpec:{field:string;kind:string}[]}
export interface Progress {completed:number;total:number;current:string;status:string;error?:string;review?:string;suggestions?:Suggestion[]}
