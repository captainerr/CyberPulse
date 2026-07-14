import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { OverviewPage } from './pages/OverviewPage';
import { KevDashboardPage } from './pages/KevDashboardPage';
import { BreachesPage } from './pages/BreachesPage';
import { BriefingPage } from './pages/BriefingPage';
import { HuntingPage } from './pages/HuntingPage';
import { NavBar } from './components/NavBar';
import { ThemeProvider } from './contexts/ThemeContext';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/catalog" element={<KevDashboardPage />} />
          <Route path="/breaches" element={<BreachesPage />} />
          <Route path="/briefing" element={<BriefingPage />} />
          <Route path="/hunting" element={<HuntingPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
};

