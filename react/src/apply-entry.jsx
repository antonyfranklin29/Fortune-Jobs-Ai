import React from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './shared/supabase.js';
import './apply/apply.css';
import { ApplyPage, createApplyClient } from './apply/ApplyPage.jsx';

createRoot(document.getElementById('root')).render(<ApplyPage client={createApplyClient(supabase)} />);
