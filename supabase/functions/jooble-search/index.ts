import { createPartnerHandler } from '../_shared/live-job-partner.mjs';
import { searchJooble } from './search.mjs';

Deno.serve(createPartnerHandler({
  getKey: () => Deno.env.get('JOOBLE_API_KEY'),
  search: searchJooble,
}));
