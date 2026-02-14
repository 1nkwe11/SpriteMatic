import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false
  };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Unhandled UI error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-screen place-items-center p-8">
          <div className="max-w-md rounded-2xl border border-[var(--brand-coral)]/60 bg-[var(--ink-900)]/95 p-6 text-[var(--ink-100)]">
            <h1 className="font-display text-2xl text-[var(--brand-sand)]">UI crashed</h1>
            <p className="mt-3 text-sm text-[var(--ink-200)]">
              Something unexpected happened in the client. Reload this page and retry.
            </p>
            <button
              type="button"
              className="mt-6 rounded-full bg-[var(--brand-sand)] px-4 py-2 text-sm font-semibold text-[var(--ink-900)]"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
