import { createRoot } from "react-dom/client";
import { Component, type ReactNode, type ErrorInfo } from "react";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as Error;
      return (
        <div style={{ padding: 24, fontFamily: "monospace", background: "#1a1a2e", color: "#ff6b6b", minHeight: "100vh" }}>
          <h2 style={{ color: "#fff" }}>App crashed</h2>
          <p style={{ color: "#ffd93d" }}>{e.message}</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#aaa" }}>{e.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
