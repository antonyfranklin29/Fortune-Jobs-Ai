import React,{useEffect,useState} from 'react';
import {badgeFor} from './h1b.js';
export function H1bBadge({job}){
 const [badge,setBadge]=useState(null);
 useEffect(()=>{let active=true;setBadge(null);badgeFor(job).then(value=>{if(active)setBadge(value)});return()=>{active=false};},[job.company,job.canonical_role,job.job_title]);
 return badge?<a className="featured-fit h1b-badge" href={badge.href} title="Filing history does not guarantee sponsorship; confirm with the employer.">Filed H-1B LCAs (FY{badge.year})</a>:null;
}
