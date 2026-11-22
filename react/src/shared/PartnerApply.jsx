import React from 'react';
import '../../../source-tracking.js';
export const isPartnerJob = job => ['whatjobs', 'jobg8', 'jooble', 'careerjet'].includes(job?.source);
export function PartnerApply({ job, children, className, onClick }) {
  return <button type="button" className={className} onClick={() => {
    onClick?.();
    if (['whatjobs','jobg8'].includes(job.source)) window.FJSourceTracking.navigate(job);
    else window.open(job.apply_url, '_blank', 'noopener,noreferrer');
  }}>{children}</button>;
}
