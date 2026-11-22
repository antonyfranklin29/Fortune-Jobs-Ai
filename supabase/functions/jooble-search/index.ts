import { createPartnerAdmission } from '../_shared/partner-protection.mjs';
import { createPartnerHandler } from '../_shared/live-job-partner.mjs';
import { searchJooble } from './search.mjs';

Deno.serve(createPartnerHandler({
  admit: createPartnerAdmission({ getEnv: (name: string) => Deno.env.get(name) }),
  getKey: () => Deno.env.get('JOOBLE_API_KEY'),
  search: searchJooble,
}));
