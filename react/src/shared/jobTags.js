import sectors from '../../../config/care-sectors.json' with { type: 'json' };
import roles from '../../../config/job-roles.json' with { type: 'json' };
export const CARE_ROLES = new Set([...sectors.healthcare, ...sectors.transport]);
export const ROLE_OPTIONS = roles.roles.filter(role => CARE_ROLES.has(role.id));
const aliases = { rn: 'registered-nurse', nurse: 'registered-nurse', 'travel nurse': 'registered-nurse', cna: 'certified-nursing-assistant', lpn: 'licensed-practical-nurse', lvn: 'licensed-practical-nurse', 'cdl driver': 'cdl-truck-driver', 'cdl-a driver': 'cdl-truck-driver' };
export function careRole(query) {
  const value = String(query || '').toLowerCase().trim().replace(/\b(?:night|day|evening|weekend|prn|shift)\b/g, '').replace(/\s+/g, ' ').trim();
  const id = aliases[value];
  return ROLE_OPTIONS.find(role => role.id === id || role.name.toLowerCase() === value || role.include.some(pattern => new RegExp(pattern, 'i').test(value))) || null;
}
export const discoveryRole = query => careRole(query) || roles.roles.find(role => role.name.toLowerCase() === String(query || '').toLowerCase().trim()) || null;
export const TAG_OPTIONS = {
  shift: ['Day', 'Night', 'Evening', 'PRN', 'Weekend'],
  license: ['RN', 'LPN', 'CNA', 'CDL-A', 'CDL-B'],
  specialty: ['ICU', 'ER', 'Med-Surg', 'Home Health', 'OR', 'Long-haul', 'Local', 'Regional'],
};
const evidence = [
  ['shift', 'Day', /\bday(?:s|time)?\s+shift\b|\bshift\s*:?\s*day\b/i],
  ['shift', 'Night', /\bnight(?:s)?(?:\s+shift)?\b/i], ['shift', 'Evening', /\bevening(?:s|\s+shift)?\b/i],
  ['shift', 'PRN', /\bPRN\b/], ['shift', 'Weekend', /\bweekend(?:s|\s+shift)?\b/i],
  ['license', 'RN', /\bRN\b|\bregistered nurse\b/i], ['license', 'LPN', /\bLPN\b|\blicensed practical nurse\b/i],
  ['license', 'CNA', /\bCNA\b|\bcertified nurs(?:ing|e) assistant\b/i],
  ['license', 'CDL-A', /\bCDL[ -]?A\b|\bclass\s+A\s+(?:CDL|commercial driver)/i],
  ['license', 'CDL-B', /\bCDL[ -]?B\b|\bclass\s+B\s+(?:CDL|commercial driver)/i],
  ['specialty', 'ICU', /\bICU\b|\bintensive care\b/i], ['specialty', 'ER', /\bER\b|\bemergency (?:room|department)\b/],
  ['specialty', 'Med-Surg', /\bmed[ -]?surg\b|\bmedical[ /-]surgical\b/i],
  ['specialty', 'Home Health', /\bhome health\b/i], ['specialty', 'OR', /\bOR\b(?=\s+(?:nurse|RN|unit))|\b(?:RN|[Nn]urse)\s*[-,]?\s*OR\b|\b[Oo]perating [Rr]oom\b/],
  ['specialty', 'Long-haul', /\blong[ -]haul\b/i], ['specialty', 'Local', /\blocal\s+(?:CDL[ -]?[AB]?\s+)?(?:route|driver|driving|delivery|truck)\b/i],
  ['specialty', 'Regional', /\bregional\s+(?:CDL[ -]?[AB]?\s+)?(?:route|driver|driving|delivery|truck)\b/i],
];
export function jobTags(job) {
  const text = String(job?.job_title || '') + ' ' + String(job?.job_description || '').replace(/<[^>]*>/g, ' ');
  const tags = { shift: [], license: [], specialty: [], pay: [] };
  for (const [kind, label, pattern] of evidence) {
    const match = pattern.exec(text);
    if (match && !/\b(?:no|without|not required)[^.!?\n]{0,24}$/i.test(text.slice(Math.max(0, match.index-40), match.index))) tags[kind].push(label);
  }
  const salary = String(job?.salary || '');
  if (/\/(?:hr|hour)\b|\bper hour\b|\bhourly\b/i.test(salary) && /\$\s*\d/.test(salary)) tags.pay.push(salary);
  return tags;
}
export function matchesJobTags(job, filters) {
  const tags = jobTags(job);
  return Object.entries(TAG_OPTIONS).every(([kind, values]) => !filters[kind] || (values.includes(filters[kind]) && tags[kind].includes(filters[kind])));
}
