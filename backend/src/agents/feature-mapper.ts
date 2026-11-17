import { z } from 'zod';
import { featureMapSchema, TestCase } from '../schemas';
import { Agent } from './agent';

export const featureMapper: Agent<TestCase[], z.infer<typeof featureMapSchema>> = {
  name: 'feature-mapper',
  output: featureMapSchema,
  instructions: 'Group these normalized cases into features. Assign each test case ID to exactly one feature. Infer fields, constraints, rules and flows conservatively; explicitly label assumptions. Classify coverage using the schema categories. Each category must appear in either coveredCategories or uncoveredCategories, never both. Covered means at least one existing case exercises it, not comprehensive coverage. Return the feature map. Data:',
  buildInput: cases => JSON.stringify(cases),
};
