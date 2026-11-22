import { createPartnerAdmission } from '../_shared/partner-protection.mjs';
import { createPartnerHandler } from '../_shared/live-job-partner.mjs';
import { searchWhatJobs } from './search.mjs';

Deno.serve(createPartnerHandler({
  admit: createPartnerAdmission({ getEnv: (name: string) => Deno.env.get(name) }),
  getKey: () => Deno.env.get('WHATJOBS_PUBLISHER_ID')?.trim() || '7594',
  search: searchWhatJobs,
}));
