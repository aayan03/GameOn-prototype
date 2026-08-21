import { Component } from 'react';

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
    if (!this.state.error) return this.props.children;
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">⚠️</div>
          <h3>Something broke on this page</h3>
          <p className="text-soft" style={{ marginTop: 6, marginBottom: 18 }}>
            {this.state.error.message}
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
