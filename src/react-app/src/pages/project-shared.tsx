import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ProjectDetailLayout } from "../components/ProjectDetailLayout";
import { EmptyState, Panel } from "../components/ui";
import { api, ApiError, type Project } from "../lib/api";

interface ProjectState {
  loading: boolean;
  project: Project | null;
  error: string | null;
}

export function useProjectState(): ProjectState {
  const { projectId } = useParams<{ projectId: string }>();
  const [state, setState] = useState<ProjectState>({
    loading: true,
    project: null,
    error: null
  });

  useEffect(() => {
    let active = true;

    async function load() {
      if (!projectId) {
        if (active) {
          setState({ loading: false, project: null, error: "Missing project id" });
        }

        return;
      }

      setState((previous) => ({ ...previous, loading: true, error: null }));

      try {
        const response = await api.projects.get(projectId);
        if (!active) {
          return;
        }

        setState({ loading: false, project: response.project, error: null });
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof ApiError ? error.message : "Unable to load project";
        setState({ loading: false, project: null, error: message });
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [projectId]);

  return state;
}

export function ProjectPageShell(props: {
  children: (project: Project) => ReactNode;
}) {
  const { loading, project, error } = useProjectState();

  if (loading) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">Loading project details...</p>
      </Panel>
    );
  }

  if (!project) {
    return (
      <EmptyState
        title="Project unavailable"
        body={error ?? "Project was not found or you no longer have access."}
      />
    );
  }

  return (
    <ProjectDetailLayout project={project}>
      {props.children(project)}
    </ProjectDetailLayout>
  );
}
