import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { IconCheck, IconClose, IconInfo } from '../components/Icons.jsx';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((message, tone = 'info', ttl = 3800) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    toast: push,
    success: (m, ttl) => push(m, 'success', ttl),
    error:   (m, ttl) => push(m, 'error', ttl),
    info:    (m, ttl) => push(m, 'info', ttl),
    dismiss,
  }), [push, dismiss]);

  const icons = {
    success: <IconCheck style={{ width: 19, height: 19 }} />,
    error: <IconClose style={{ width: 19, height: 19 }} />,
    info: <IconInfo style={{ width: 19, height: 19 }} />,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>
            {icons[t.tone]}
            <span className="grow">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // Falling back to console keeps components usable outside the provider
  // (in tests, or a page rendered in isolation).
  if (!ctx) {
    // Deliberate: outside the provider there is nowhere to render a toast, so
    // the message goes to the console rather than vanishing. Disabled rather
    // than left as a standing warning, because a lint that always warns is a
    // lint people stop reading.
    /* eslint-disable no-console */
    return {
      toast: console.log, success: console.log, error: console.error,
      info: console.log, dismiss: () => {},
    };
    /* eslint-enable no-console */
  }
  return ctx;
}
