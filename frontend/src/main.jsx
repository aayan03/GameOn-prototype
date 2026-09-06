import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import './styles/theme.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Outermost, so every route and portal is inside the theme. */}
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
