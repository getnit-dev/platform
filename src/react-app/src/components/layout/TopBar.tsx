import { useLocation, useParams, Link } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import { Button } from "../ui/button";
import { useEffect, useState } from "react";
import { api, type Project } from "../../lib/api";

interface BreadcrumbItem {
  label: string;
  path?: string;
}

function useBreadcrumbs(): BreadcrumbItem[] {
  const location = useLocation();
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (params.projectId) {
      api.projects.get(params.projectId).then((res) => setProject(res.project)).catch(() => {});
    }
  }, [params.projectId]);

  const pathSegments = location.pathname.split("/").filter(Boolean);

  if (pathSegments.length === 0) {
    return [{ label: "Dashboard" }];
  }

  const crumbs: BreadcrumbItem[] = [];

  if (pathSegments[0] === "projects" && pathSegments.length > 1) {
    crumbs.push({ label: "Projects", path: "/" });
    if (project) {
      crumbs.push({ label: project.name, path: `/projects/${project.id}/runs` });
      if (pathSegments.length > 2) {
        const page = pathSegments[2];
        crumbs.push({
          label: page.charAt(0).toUpperCase() + page.slice(1),
        });
      }
    }
  } else if (pathSegments[0] === "settings") {
    crumbs.push({ label: "Settings" });
  }

  return crumbs;
}

export function TopBar() {
  const breadcrumbs = useBreadcrumbs();

  const handleSearchClick = () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <header className="h-12 border-b border-border bg-background px-6 flex items-center justify-between flex-shrink-0">
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
            {crumb.path ? (
              <Link
                to={crumb.path}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{crumb.label}</span>
            )}
          </div>
        ))}
      </nav>

      <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={handleSearchClick}>
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline text-xs">Search</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium md:inline-flex">
          <span className="text-xs">&#x2318;</span>K
        </kbd>
      </Button>
    </header>
  );
}
