import { Link } from "react-router-dom";
import { Panel } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-8">
      <Panel className="w-full max-w-md text-center">
        <p className="text-xs font-semibold text-primary">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The page you requested does not exist.</p>
        <Link className="mt-5 inline-block rounded-lg bg-secondary px-3 py-2 text-sm hover:bg-secondary/80" to="/">
          Back to dashboard
        </Link>
      </Panel>
    </div>
  );
}
