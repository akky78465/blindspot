import { compose } from '../agents/agent';
import { featureMapper } from '../agents/feature-mapper';
import { TestCase } from '../schemas';

export const featuresPrompt = (cases: TestCase[]) => compose(featureMapper, cases);
