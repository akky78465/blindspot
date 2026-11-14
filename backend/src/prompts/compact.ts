import { FeatureMap, TestCase } from '../schemas';
type Feature = FeatureMap['features'][number];

/** Drops empty strings and empty arrays so they cost no tokens. */
const prune = (o:Record<string,unknown>) => Object.fromEntries(Object.entries(o).filter(([,v])=>v!=='' && v!==undefined && !(Array.isArray(v) && !v.length)));

const fieldNames = (c:TestCase) => [...new Set(c.inputs.map(i=>i.field))];

/** Mapping card: enough to group a case into a feature. */
export const mapCard = (c:TestCase) => prune({id:c.id,title:c.title,type:c.type,expectedResult:c.expectedResult,fields:fieldNames(c)});
/** Edge card: the feature already carries rules and coverage, so no steps or expected results. */
export const edgeCard = (c:TestCase) => prune({id:c.id,title:c.title,type:c.type,fields:fieldNames(c)});
/** Feature view for edge analysis. Case ids are omitted because the case list carries them. */
export const featureCard = (f:Feature) => prune({name:f.name,description:f.description,
  fields:f.fields.map(x=>prune(x)),rules:f.rules,flows:f.flows,uncoveredCategories:f.uncoveredCategories});
