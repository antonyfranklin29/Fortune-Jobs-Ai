import React from 'react';
import '../../../source-tracking.js';
export const isPaidPartner = job => ['whatjobs', 'jobg8'].includes(job?.source);
export function PartnerApply({ job, children, className, onClick }) {
  return <button type="button" className={className} onClick={() => {
    onClick?.(); window.FJSourceTracking.navigate(job);
  }}>{children}</button>;
}
