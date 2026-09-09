import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { installGlobalHandlers } from './utils/errorReporter.js';
import './styles/theme.css';
import './styles/app.css';

/**
 * Before anything renders, so a failure during the first paint is still
 * caught. ErrorBoundary only sees errors thrown during render; this is what
 * picks up event handlers, timers and rejected promises, which is most of
 * what actually breaks. A no-op unless VITE_SENTRY_DSN is set.
 */
installGlobalHandlers();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Outermost, so every route and portal is inside the theme. */}
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
