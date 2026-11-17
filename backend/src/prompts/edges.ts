import { compose } from '../agents/agent';
import { EdgeInput, edgeCase } from '../agents/edge-case';

export const edgesPrompt = (feature: EdgeInput['feature'], cases: EdgeInput['cases']) => compose(edgeCase, { feature, cases });
