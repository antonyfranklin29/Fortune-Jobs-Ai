import React from 'react';
import { ResultsPage } from './ResultsPage.jsx';
import { HomeSections } from './HomeSections.jsx';
import { CategoryTiles } from './CatalogueDiscovery.jsx';
import { HiringNow } from './HiringNow.jsx';

export function LandingPage() {
  return <ResultsPage afterSearch={<><CategoryTiles /><HiringNow /></>} afterDashboard={<HomeSections />} />;
}
