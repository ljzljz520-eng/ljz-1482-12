import { Component, ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="card p-8 max-w-md text-center">
            <div className="text-2xl mb-2">😵</div>
            <h2 className="text-lg font-semibold mb-1">页面出现异常</h2>
            <p className="text-sm text-slate-500 mb-4">{this.state.error.message}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
