import { createContext, useContext, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { readStoredJson, writeStoredJson } from "./storage";

interface NavigationState {
  currentProjectId: string | null;
  recentProjects: string[];
  sidebarCollapsed: boolean;
  addRecentProject: (projectId: string) => void;
  toggleSidebar: () => void;
}

const NavigationContext = createContext<NavigationState | undefined>(undefined);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const [recentProjects, setRecentProjects] = useState<string[]>(() =>
    readStoredJson("nit:recentProjects", [])
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredJson("nit:sidebarCollapsed", false)
  );

  const currentProjectId = params.projectId ?? null;

  useEffect(() => {
    if (currentProjectId && !recentProjects.includes(currentProjectId)) {
      const updated = [currentProjectId, ...recentProjects].slice(0, 5);
      setRecentProjects(updated);
      writeStoredJson("nit:recentProjects", updated);
    }
  }, [currentProjectId, recentProjects]);

  function addRecentProject(projectId: string) {
    if (!recentProjects.includes(projectId)) {
      const updated = [projectId, ...recentProjects].slice(0, 5);
      setRecentProjects(updated);
      writeStoredJson("nit:recentProjects", updated);
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      writeStoredJson("nit:sidebarCollapsed", !prev);
      return !prev;
    });
  }

  return (
    <NavigationContext.Provider
      value={{
        currentProjectId,
        recentProjects,
        sidebarCollapsed,
        addRecentProject,
        toggleSidebar,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return context;
}
