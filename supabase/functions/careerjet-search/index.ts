import { createPartnerHandler } from '../_shared/live-job-partner.mjs';
import { searchCareerjet } from './search.mjs';

Deno.serve(createPartnerHandler({
  getKey: () => Deno.env.get('CAREERJET_API_KEY'),
  search: searchCareerjet,
}));
