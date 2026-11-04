import React from 'react';
import { createRoot } from 'react-dom/client';
import './generated/landing-base.css';
import '../../landing-experience.css';
import '../../glass.css';
import '../../glass-light.css';
import './react.css';
import { LandingPage } from './seeker/LandingPage.jsx';

createRoot(document.getElementById('root')).render(<LandingPage />);
