import React from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './shared/supabase.js';
import './styles/email-preferences.css';
import { EmailPreferencesPage, createPreferenceClient } from './info/index.js';

const client = createPreferenceClient({ sb: supabase, config: window.FJ_CONFIG });
createRoot(document.getElementById('root')).render(<EmailPreferencesPage client={client} />);
