import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/policy-base.css';
import { PrivacyPage, TermsPage, ContactPage } from './info/index.js';

const pages = { 'privacy.html': PrivacyPage, 'terms.html': TermsPage, 'contact.html': ContactPage };
const Page = pages[window.location.pathname.split('/').pop()] || PrivacyPage;
createRoot(document.getElementById('root')).render(<Page />);
