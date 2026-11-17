import { compose } from '../agents/agent';
import { normalizer } from '../agents/normalizer';

export const normalizePrompt = (data: unknown) => compose(normalizer, data);
