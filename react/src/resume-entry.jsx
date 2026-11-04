import React from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './shared/supabase.js';
import { createAccountServices } from './account/services.jsx';
import { ResumeServicesProvider, createResumeServices, createBrowserResumeReaders, ResumeSearchPage, ResumeBuilderPage } from './resume/index.js';
import './resume-entry.css';

const account = createAccountServices({ sb: supabase, config: window.FJ_CONFIG });
const readers = createBrowserResumeReaders({ extractionUrl: new URL('../resume-extraction.mjs', window.location.href).href });
const services = createResumeServices({ account, ...readers });
const Page = window.location.pathname.endsWith('/resume-builder.html') ? ResumeBuilderPage : ResumeSearchPage;
createRoot(document.getElementById('root')).render(<ResumeServicesProvider services={services}><Page /></ResumeServicesProvider>);
