import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/results-base.css';
import '../../landing-experience.css';
import '../../glass.css';
import '../../glass-light.css';
import './react.css';
import { ResultsPage } from './seeker/ResultsPage.jsx';

createRoot(document.getElementById('root')).render(<ResultsPage />);
