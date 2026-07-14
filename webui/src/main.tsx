import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';

// Stale key from the removed light/dark theme toggle.
localStorage.removeItem('theme');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
