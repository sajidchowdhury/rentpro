// Client-safe RBAC (no server imports) — the single source of truth for
// role -> allowed nav views. Imported by both the client shell (page.tsx)
// and the server (rentData re-uses it). Mirrors prisma/schema.prisma's
// menu_permission concept (in production, per-user menu rows override this).

export type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "DATA_ENTRY" | "TENANT";

export type ViewId =
  | "dashboard" | "generate" | "collect" | "expenses"
  | "vacate" | "properties" | "tenants" | "reports" | "platform";

export const ROLE_VIEWS: Record<Role, ViewId[]> = {
  SUPER_ADMIN: ["dashboard", "generate", "collect", "expenses", "vacate", "properties", "tenants", "reports", "platform"],
  ADMIN: ["dashboard", "generate", "collect", "expenses", "vacate", "properties", "tenants", "reports", "platform"],
  MANAGER: ["dashboard", "generate", "collect", "expenses", "vacate", "properties", "tenants", "reports"],
  DATA_ENTRY: ["dashboard", "collect", "expenses", "tenants"],
  TENANT: ["dashboard"],
};

export function getAllowedViews(role: Role | undefined | null): ViewId[] {
  if (!role) return ["dashboard"];
  return ROLE_VIEWS[role] ?? ["dashboard"];
}

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  DATA_ENTRY: "Data Entry",
  TENANT: "Tenant",
};
