import React, { useState } from 'react';
import { TailorView, CoverLetterView } from '../seeker/AiTools.jsx';

export function SavedMaterials({ job }) {
  const [active, setActive] = useState(null);
  const materials = job.materials || {};
  const available = [['tailor_resume', 'Résumé ✓'], ['cover_letter', 'Cover letter ✓']]
    .filter(([kind]) => materials[kind]?.result);
  if (!available.length) return null;
  const material = materials[active];
  const View = active === 'cover_letter' ? CoverLetterView : TailorView;
  return <div className="saved-materials">
    <div className="ai-actions" aria-label="Saved application materials">
      {available.map(([kind, label]) => <button key={kind} type="button" aria-expanded={active === kind}
        onClick={() => setActive(active === kind ? null : kind)}>{label}</button>)}
    </div>
    {material && <section aria-label={active === 'cover_letter' ? 'Saved cover letter' : 'Saved tailored résumé'}>
      <View r={material.result} identity={material.identity} job={job} />
    </section>}
  </div>;
}
