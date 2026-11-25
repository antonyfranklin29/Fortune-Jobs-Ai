// Constructors are injected so the same streaming parser runs in Deno and Node fixture tests.
export async function readZip(body, onBatch, { Unzip, UnzipInflate, SaxesParser }, batchSize = 500) {
  if (!body) throw new Error('missing_body');
  let jobs = [], fields, field, depth = 0, count = 0, files = 0, ended = false, bytes = 0, failure;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const xml = new SaxesParser();
  const fail = () => { throw new Error('invalid_xml'); };
  xml.on('error', fail); xml.on('doctype', fail);
  xml.on('opentag', tag => {
    depth++;
    if (depth === 1 && tag.name !== 'Jobs') fail();
    if (depth === 2) { if (tag.name !== 'Job') fail(); fields = Object.create(null); }
    if (depth === 3) { field = tag.name; if (Object.hasOwn(fields, field)) fail(); fields[field] = ''; }
  });
  const text = value => {
    if (depth === 3 && fields && field) {
      fields[field] += value;
      if (fields[field].length > 100_000) throw new Error('field_too_large');
    } else if (depth < 3 && value.trim()) fail();
  };
  xml.on('text', text); xml.on('cdata', text);
  xml.on('closetag', () => {
    if (depth === 3) field = null;
    if (depth === 2) { jobs.push(fields); fields = null; if (++count > 200_000) throw new Error('too_many_jobs'); }
    depth--;
  });
  xml.on('end', () => { ended = true; });
  const unzip = new Unzip(file => {
    // Exactly one XML member; directories are harmless, executable/extra files are rejected.
    if (file.name.endsWith('/')) return;
    if (!/\.xml$/i.test(file.name) || ++files !== 1 || /(^|[\/])\.\.([\/]|$)/.test(file.name)) throw new Error('invalid_archive');
    file.ondata = (error, data, final) => {
      try {
        if (error) throw error;
        bytes += data.length;
        if (bytes > 512 * 1024 * 1024) throw new Error('feed_too_large');
        xml.write(decoder.decode(data, { stream: !final }));
        if (final) xml.close();
      } catch (error) { failure = error; }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const flush = async final => {
    if (failure) throw failure;
    while (jobs.length >= batchSize || (final && jobs.length)) await onBatch(jobs.splice(0, batchSize));
  };
  const reader = body.getReader();
  let compressed = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      compressed += value.length;
      if (compressed > 100 * 1024 * 1024) throw new Error('archive_too_large');
      for (let i = 0; i < value.length; i += 1024) {
        unzip.push(value.subarray(i, i + 1024), false);
        await flush(false);
      }
    }
    unzip.push(new Uint8Array(), true);
    if (failure) throw failure;
    if (files !== 1 || !ended || depth !== 0) throw new Error('incomplete_archive');
    await flush(true);
    return count;
  } finally { await reader.cancel().catch(() => {}); }
}

export const safeHttps = value => {
  try { if (typeof value !== 'string' || value.length > 4000 || /[\x00-\x1f\x7f]/.test(value)) return false; const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !/\s/.test(value); } catch { return false; }
};

export function normalize(raw, { stateIndex, classify, cleanText }) {
  const t = (key, max = 300) => cleanText(raw[key] || '', max);
  const title = t('Position'), company = t('AdvertiserName'), id = t('SenderReference', 200);
  // Missing optional nodes are normal. A row we cannot list (no identity, outside the US, unknown
  // state, unsafe link) is skipped and counted; the handler aborts the whole snapshot when too
  // many rows are skipped, so a malformed feed is never mistaken for provider deletions.
  if (!id || !title || !company || /^jobg8(?:\b|$)/i.test(company)) return { skip: 'invalid_identity' };
  if (!/^(us|usa|u\.s\.a?\.?|united states|united states of america)$/i.test(t('Country'))) return { skip: 'non_us_job' };
  const state = stateFor(t('Location'), stateIndex) || stateFor(t('Area'), stateIndex);
  if (!state) return { skip: 'unknown_state' };
  const url = raw.ApplicationURL?.trim();
  if (!safeHttps(url)) return { skip: 'invalid_application_url' };
  const number = key => /^\d+(?:\.\d+)?$/.test(raw[key] || '') ? Number(raw[key]) : null;
  const min = number('SalaryMinimum'), max = number('SalaryMaximum');
  const currency = t('SalaryCurrency', 10);
  const amount = n => (currency === 'USD' ? '$' : currency + ' ') + n.toLocaleString('en-US');
  const salary = min || max ? [min, max].filter(n => n != null && n > 0).map(amount).join(' – ') + (t('SalaryPeriod') ? ' / ' + t('SalaryPeriod', 30) : '') : null;
  // Reuse the portal's plain-text cleaner; remove active blocks first. Never insert feed HTML.
  const description = cleanText(String(raw.Description || '').replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' '), 10_000);
  const meta = Object.fromEntries(['Classification','SubClassification','AdditionalClassification1','AdditionalClassification2','AdditionalClassification3','AdditionalClassification4','AdvertiserType','DisplayReference','ConversionType','LogoURL','Language','StartDate','Duration','WorkHours','SalaryAdditional'].filter(k => raw[k]).map(k => [k, t(k, 1000)]));
  const canonical = classify(title);
  return { source_listing_id: id, job_title: title, company, location: cityFor(t('Area') || t('Location'), state, stateIndex),
    state_code: state, country: 'us', canonical_role: canonical, category: canonical || t('Classification') || null,
    job_description: description, apply_url: url, salary, employment_type: t('EmploymentType') || null,
    jobg8_sell_price: number('SellPrice'), jobg8_sell_price_currency: t('SellPriceCurrency', 3) || null,
    jobg8_revenue_type: ['CPA','CPC'].includes(raw.RevenueType) ? raw.RevenueType : null,
    jobg8_job_type: ['APPLICATION','ATS','TRAFFIC'].includes(raw.JobType) ? raw.JobType : null,
    source_metadata: meta };
}

// Location is normally a state code or name, but tolerate "Atlanta, GA" / "Georgia, US" forms.
function stateFor(value, stateIndex) {
  const v = String(value || '').trim();
  if (!v) return null;
  const direct = stateIndex.get(v.toUpperCase()) || stateIndex.get(v.toLowerCase());
  if (direct) return direct;
  const parts = v.split(',').map(p => p.trim()).filter(p => p && !/^(us|usa|united states)$/i.test(p));
  for (const part of parts.reverse()) {
    const hit = stateIndex.get(part.toUpperCase()) || stateIndex.get(part.toLowerCase()) || stateIndex.get(part.replace(/\s+\d{5}(-\d{4})?$/, '').toUpperCase());
    if (hit) return hit;
  }
  return null;
}
function cityFor(area, state, stateIndex) {
  const city = String(area || '').split(',')[0].trim();
  return city && stateFor(city, stateIndex) !== state ? city + ', ' + state : state;
}
