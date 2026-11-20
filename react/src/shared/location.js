// Adzuna lists U.S. places as "City, Some County". Show "City, ST" instead (Franklin, Nov 19 2026).
export function cityState(location, stateCode) {
  const text = String(location || '');
  if (!/^[A-Z]{2}$/.test(stateCode || '') || !/,\s*[^,]*\bcounty\s*$/i.test(text)) return text;
  return `${text.split(',')[0].trim()}, ${stateCode}`;
}
