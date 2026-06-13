/* Project templates (Jira "project templates", v1): a template seeds a new
   project's component registry and custom-field definitions. The workflow is
   shared until per-project schemes move into the DB, so 'cadence-pdlc' (the
   default) seeds nothing — today's behaviour, unchanged. */
import type { FieldKind } from "./repo/fields";

export interface ProjectTemplate {
  id: string;
  name: string;
  components: string[];
  fieldDefs: { key: string; name: string; kind: FieldKind; options: string[] | null }[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "cadence-pdlc",
    name: "Cadence PDLC (default)",
    components: [],
    fieldDefs: [],
  },
  {
    id: "simple-kanban",
    name: "Simple Kanban",
    components: ["Frontend", "Backend", "Infra"],
    fieldDefs: [
      { key: "environment", name: "Environment", kind: "select", options: ["dev", "staging", "prod"] },
      { key: "external_ref", name: "External reference", kind: "text", options: null },
    ],
  },
];

export function templateById(id: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find((t) => t.id === id) ?? null;
}
