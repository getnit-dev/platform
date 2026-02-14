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
    <header className="h-14 border-b border-divider bg-background/80 backdrop-blur-sm px-8 flex items-center justify-between flex-shrink-0 sticky top-0 z-30">
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-default-400/50" />}
            {crumb.path ? (
              <Link
                to={crumb.path}
                className="text-default-500 hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{crumb.label}</span>
            )}
          </div>
        ))}
      </nav>

      <Button variant="outline" size="sm" className="gap-2 text-default-500" onClick={handleSearchClick}>
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline text-xs">Search</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded-md border border-default-200 bg-default-50 px-1.5 font-mono text-[10px] font-medium text-default-400 md:inline-flex">
          <span className="text-xs">&#x2318;</span>K
        </kbd>
      </Button>
    </header>
  );
}
