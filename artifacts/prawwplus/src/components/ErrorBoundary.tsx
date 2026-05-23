import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    if (import.meta.env.PROD) {
      console.error("[ErrorBoundary]", error.message);
    } else {
      console.error("[ErrorBoundary]", error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = "/dashboard";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: "var(--bg-1, #0a0a0a)",
            gap: 20,
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "rgba(255,69,58,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlertTriangle style={{ width: 28, height: 28, color: "#ff453a" }} />
          </div>

          <div style={{ textAlign: "center", maxWidth: 300 }}>
            <p
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "rgba(255,255,255,0.9)",
                margin: "0 0 8px",
                fontFamily: "var(--font-display, system-ui)",
              }}
            >
              Something went wrong
            </p>
            <p
              style={{
                fontSize: 14,
                color: "rgba(255,255,255,0.4)",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              The app hit an unexpected error. Tap below to return to the
              dashboard.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre
                style={{
                  marginTop: 16,
                  padding: "12px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  fontSize: 11,
                  color: "#ff6b6b",
                  textAlign: "left",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {this.state.error.message}
              </pre>
            )}
          </div>

          <button
            onClick={this.handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 24px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <RefreshCw style={{ width: 16, height: 16 }} />
            Return to Dashboard
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
