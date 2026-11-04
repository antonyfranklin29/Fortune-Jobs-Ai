// Résumé routes for the React app. Keep the .html URLs (links, bookmarks and
// find-jobs.html?resume=1 depend on them).
import { ResumeSearchPage } from './ResumeSearchPage.jsx';
import { ResumeBuilderPage } from './ResumeBuilderPage.jsx';

export { ResumeSearchPage, COUNTRIES } from './ResumeSearchPage.jsx';
export { ResumeBuilderPage } from './ResumeBuilderPage.jsx';
export { ResumeServicesProvider, createResumeServices, createBrowserResumeReaders, useResumeServices, readResumeFile, readErrorText } from './services.jsx';
export * as guestResume from './lib/guestResume.js';
export * as resumeMatching from './lib/resumeMatching.js';
export * as resumeBuilder from './lib/resumeBuilder.js';

export const resumeRoutes = [
  { path: '/resume-search.html', Component: ResumeSearchPage, title: 'Find jobs with your résumé · Fortune Jobs AI' },
  { path: '/resume-builder.html', Component: ResumeBuilderPage, title: 'Résumé workspace · Fortune Jobs AI' },
];
