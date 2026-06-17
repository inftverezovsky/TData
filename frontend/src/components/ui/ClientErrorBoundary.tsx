"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
};

type State = {
  hasError: boolean;
};

export class ClientErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ClientErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className={
          this.props.className ||
          "rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800"
        }
      >
        <div className="text-xs font-black uppercase tracking-widest text-amber-700">
          {this.props.title || "Раздел временно недоступен"}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-amber-800">
          {this.props.description ||
            "Остальная страница продолжает работать. Обновите раздел или проверьте логи компонента."}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ hasError: false })}
          className="mt-4 rounded-lg border border-amber-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-100"
        >
          Повторить
        </button>
      </div>
    );
  }
}
