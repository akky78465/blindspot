import { edgeCase } from './edge-case';
import { featureMapper } from './feature-mapper';
import { normalizer } from './normalizer';

export const agents = { normalizer, featureMapper, edgeCase };
export { compose } from './agent';
export { normalizer } from './normalizer';
export { featureMapper } from './feature-mapper';
export { edgeCase } from './edge-case';
