import React from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './shared/supabase.js';
import { AccountServicesProvider, createAccountServices, createBrowserResumeTools, LoginPage, EmployerLoginPage, ProfilePage } from './account/index.js';
import { EmployerWorkspacePage } from './employer/index.js';

const services = createAccountServices({
  sb: supabase,
  config: window.FJ_CONFIG,
  resumeTools: createBrowserResumeTools({ extractionUrl: new URL('../resume-extraction.mjs', window.location.href).href })
});

const pages = {
  'login.html': LoginPage,
  'employer-login.html': EmployerLoginPage,
  'profile.html': ProfilePage,
  'employers.html': EmployerWorkspacePage
};
const Page = pages[window.location.pathname.split('/').pop()] || LoginPage;
createRoot(document.getElementById('root')).render(
  <AccountServicesProvider services={services}><Page /></AccountServicesProvider>
);
