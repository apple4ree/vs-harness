import { Component, type ErrorInfo, type ReactNode } from "react";

export class WorkbenchBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Witch workbench error", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="recovery-screen" role="alert">
        <section>
          <span className="eyebrow">Witch · Workbench recovery</span>
          <h1>The workbench needs to reload</h1>
          <p>
            Your last editor recovery snapshot is retained in the app profile.
            Reload to recover it; the most recent keystrokes may not have
            reached the snapshot yet.
          </p>
          <details>
            <summary>Technical details</summary>
            <pre>{this.state.error}</pre>
          </details>
          <button
            className="primary-action"
            onClick={() => window.location.reload()}
          >
            Reload workbench
          </button>
        </section>
      </main>
    );
  }
}
