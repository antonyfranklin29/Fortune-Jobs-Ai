// Account pages for the React app. Route these at the legacy URLs so Supabase
// redirect URLs and existing links keep working.
export { LoginPage, EmployerLoginPage, friendlyAuthError } from './AuthPage.jsx';
export { ProfilePage } from './ProfilePage.jsx';
export { AccountServicesProvider, createAccountServices, useAccountServices } from './services.jsx';
export { createBrowserResumeTools } from './resumeTools.js';
export { AccountNav, Avatar, StatusMessage, AdzunaCredit } from './components.jsx';

export const accountRoutes = [
  { path: '/login.html', export: 'LoginPage' },
  { path: '/employer-login.html', export: 'EmployerLoginPage' },
  { path: '/profile.html', export: 'ProfilePage' },
];
