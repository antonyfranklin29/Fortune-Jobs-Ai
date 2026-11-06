import React from 'react';
import { ResultsPage } from './ResultsPage.jsx';
import { HomeSections } from './HomeSections.jsx';

export function LandingPage() {
  return <ResultsPage afterDashboard={<HomeSections />} />;
}
