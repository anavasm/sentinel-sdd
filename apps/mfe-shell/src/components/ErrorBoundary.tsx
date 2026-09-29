import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Short context label rendered in the fallback (e.g. the failed MFE name). */
  contextLabel: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Top-level guard for remotely loaded MFE views: a crashed remote must render
 * a friendly fallback, never a blank page (US-1 edge case; ADR-005).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Errors must be explicit — never swallowed silently.
    console.error(`[${this.props.contextLabel}] render failed`, error, errorInfo.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="mx-auto mt-16 max-w-xl rounded-lg border border-sentinel-failed/40 bg-sentinel-panel p-6 text-center"
        >
          <h2 className="text-lg font-semibold text-sentinel-failed">
            {this.props.contextLabel} failed to load
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            The module could not be rendered. Retry later or return to the audit configuration.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
