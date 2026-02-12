import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./lib/theme-context";
import { initSentry, Sentry } from "./lib/sentry";
import { App } from "./App";
import "./styles.css";

initSentry();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={() => (
        <div style={{ padding: 40, textAlign: "center" }}>
          <h1>Something went wrong</h1>
          <p>The error has been reported. Please try refreshing the page.</p>
        </div>
      )}
      showDialog={false}
    >
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>
);
