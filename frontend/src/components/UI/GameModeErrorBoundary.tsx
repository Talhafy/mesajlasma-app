import { Component, type ErrorInfo, type ReactNode } from 'react';

interface GameModeErrorBoundaryProps {
  children: ReactNode;
  onExit: () => void;
}

interface GameModeErrorBoundaryState {
  hasError: boolean;
}

/** Keeps a GameHub runtime/chunk error from turning the entire application white. */
export default class GameModeErrorBoundary extends Component<
  GameModeErrorBoundaryProps,
  GameModeErrorBoundaryState
> {
  state: GameModeErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GameModeErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Oyun modu render hatası:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="app-loading" role="alert">
        <p>Oyun alanı açılırken bir hata oluştu.</p>
        <button type="button" onClick={this.props.onExit}>Sohbete dön</button>
      </div>
    );
  }
}
