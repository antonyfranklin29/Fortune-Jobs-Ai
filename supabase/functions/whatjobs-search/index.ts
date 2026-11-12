import { createPartnerHandler } from '../_shared/live-job-partner.mjs';
import { searchWhatJobs } from './search.mjs';

Deno.serve(createPartnerHandler({
  getKey: () => Deno.env.get('WHATJOBS_PUBLISHER_ID')?.trim() || '7594',
  search: searchWhatJobs,
}));
