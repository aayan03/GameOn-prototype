import { Component } from 'react';

/**
 * A failed dynamic import, rather than a bug in the page.
 *
 * After a deploy the old index.html in a user's tab still points at chunk
 * filenames that no longer exist, so the next route they open throws. It is
 * not a crash — the fix is simply to reload and pick up the new manifest —
 * so it gets its own wording instead of an alarming error message.
 */
function isStaleChunkError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(text);
}

/** Keeps a render error from blanking the whole app. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isStaleChunkError(error);

    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">{stale ? '🔄' : '⚠️'}</div>
          <h3>{stale ? 'A new version of GameOn is available' : 'Something broke on this page'}</h3>
          <p className="text-soft" style={{ marginTop: 6, marginBottom: 18 }}>
            {stale
              ? 'This tab has been open since the last update. Reload to pick it up — nothing is lost.'
              // The raw message is useful in development and meaningless to a
              // customer, so only the generic line ships in production.
              : (import.meta.env.DEV
                  ? error.message
                  : 'We have logged it. Reloading usually clears it — if it keeps happening, please let us know.')}
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
