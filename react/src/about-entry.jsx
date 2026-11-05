import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/about-base.css';
import { AboutPage } from './info/index.js';

createRoot(document.getElementById('root')).render(<AboutPage />);
