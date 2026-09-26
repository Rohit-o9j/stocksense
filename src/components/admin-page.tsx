/**
 * Admin dashboard.
 *
 * Four regions, ordered by how often an admin needs them:
 *   1. Health   — is the system in a state where it can be used at all
 *   2. Data     — load or clear the demonstration dataset
 *   3. People   — who has access, at what level
 *   4. Runtime  — environment facts worth knowing before a demo or deploy
 */
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageTitle } from "@/components/stock-shell";
import { useAuth } from "@/lib/auth";
import {
  deleteUser as deleteUserFn,
  getAdminOverview,
  resetInventory as resetInventoryFn,
  seedDemoInventory,
  seedReferenceData,
  setUserRole as setUserRoleFn,
  type AdminOverview,
} from "@/lib/admin-api";

const ROLES = ["Warehouse Staff", "Inventory Manager", "Admin"] as const;
type Role = (typeof ROLES)[number];

const ADMIN_KEY = ["admin", "overview"] as const;

const COUNT_LABELS: Record<string, string> = {
  users: "Users",
  categories: "Categories",
  warehouses: "Warehouses",
  locations: "Locations",
  products: "Products",
  reorderingRules: "Reorder rules",
  operations: "Documents",
  operationLines: "Document lines",
  stockMoves: "Ledger entries",
  stockQuants: "Stock records",
};

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card ${className ?? ""}`}>
      {children}
    </section>
  );
}

function PanelHead({
  icon: Icon,
  title,
  note,
  action,
}: {
  icon: typeof Database;
  title: string;
  note: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
      <div className="flex gap-3">
        <span className="mt-0.5 text-primary">
          <Icon className="size-[18px]" />
        </span>
        <div>
          <h2 className="font-semibold leading-tight">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 ${tone === "warn" ? "border-warning/40" : "border-border"}`}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <strong className="mt-3 block text-2xl font-semibold tabular-nums">{value}</strong>
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const query = useQuery({
    queryKey: ADMIN_KEY,
    queryFn: () => getAdminOverview(),
    retry: false,
    enabled: user?.role === "Admin",
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
    // Inventory screens read a different cache; keep them honest too.
    await queryClient.invalidateQueries({ queryKey: ["stock"] });
  }, [queryClient]);

  const run = useCallback(
    async (key: string, action: () => Promise<string | void>) => {
      setBusy(key);
      try {
        const message = await action();
        await refresh();
        toast.success(typeof message === "string" && message ? message : "Done");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That action failed");
      } finally {
        setBusy("");
      }
    },
    [refresh],
  );

  if (user && user.role !== "Admin") {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <ShieldAlert className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">Admin access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You are signed in as {user.role}. Ask an administrator to grant you access.
        </p>
      </div>
    );
  }

  if (query.isPending) {
    return <p className="py-20 text-center text-sm text-muted-foreground">Loading admin data…</p>;
  }

  if (query.error) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <AlertTriangle className="mx-auto size-8 text-danger" />
        <h1 className="mt-4 text-lg font-semibold">Could not load admin data</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {query.error instanceof Error ? query.error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  const data: AdminOverview = query.data;
  const healthy = data.integrity.issues.length === 0;
  const operable = data.missingVirtualLocations.length === 0 && (data.counts["locations"] ?? 0) > 0;

  return (
    <>
      <PageTitle
        title="Admin"
        subtitle="System health, demonstration data and access control"
        action={
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw /> Refresh
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={data.counts["users"] ?? 0} />
        <Stat label="Products" value={data.counts["products"] ?? 0} />
        <Stat label="Documents" value={data.counts["operations"] ?? 0} />
        <Stat label="Ledger entries" value={data.counts["stockMoves"] ?? 0} />
      </div>

      {/* 1 — Health ------------------------------------------------------- */}
      <Panel className="mb-5">
        <PanelHead
          icon={Activity}
          title="System health"
          note="The ledger and on-hand quantities must agree for every product."
        />
        <div className="space-y-4 p-4">
          <div
            className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
              healthy
                ? "border-success/30 bg-success-subtle text-success"
                : "border-danger/30 bg-danger-subtle text-danger"
            }`}
          >
            {healthy ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <div>
              <p className="font-medium">
                {healthy
                  ? `Ledger matches on hand across all ${data.integrity.checked} products.`
                  : `${data.integrity.issues.length} of ${data.integrity.checked} products disagree with the ledger.`}
              </p>
              {!healthy && (
                <ul className="mt-2 space-y-1 text-xs">
                  {data.integrity.issues.map((issue) => (
                    <li key={issue.sku}>
                      {issue.name} ({issue.sku}) — on hand {issue.quants}, ledger {issue.ledger}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {!operable && (
            <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-subtle p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Stock operations are not possible yet.</p>
                <p className="mt-1 text-xs">
                  {data.missingVirtualLocations.length > 0
                    ? `Missing required locations: ${data.missingVirtualLocations.join(", ")}.`
                    : "No storage locations exist."}{" "}
                  Load the reference data below.
                </p>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {Object.entries(data.counts).map(([table, count]) => (
              <div key={table}>
                <dt className="text-xs text-muted-foreground">{COUNT_LABELS[table] ?? table}</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      {/* 2 — Demo data ---------------------------------------------------- */}
      <Panel className="mb-5">
        <PanelHead
          icon={Database}
          title="Demonstration data"
          note="Runs the same routines as the seed CLI. Stock is created through real moves, so the ledger stays consistent."
        />
        <div className="divide-y divide-border">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Reference data</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Categories, two warehouses, storage locations and the Vendors / Customers /
                Inventory Loss locations every operation needs. Safe to run repeatedly.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy !== ""}
              onClick={() => void run("baseline", () => seedReferenceData())}
            >
              {busy === "baseline" && <Loader2 className="size-4 animate-spin" />}
              Load reference data
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Demo inventory</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Twelve products, six completed documents and ten in flight, including the Steel Rods
                walkthrough that ends at 77 kg across two locations. Refuses to run if products
                already exist.
              </p>
            </div>
            <Button
              disabled={busy !== ""}
              onClick={() => void run("demo", () => seedDemoInventory())}
            >
              {busy === "demo" && <Loader2 className="size-4 animate-spin" />}
              Load demo inventory
            </Button>
          </div>

          <div className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-danger">Reset inventory</p>
                <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                  Deletes every product, document, ledger entry, location, warehouse and category.
                  User accounts are <strong>not</strong> touched, so nobody is locked out. This
                  cannot be undone.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="reset-confirm">
                  Type RESET to confirm
                </label>
                <Input
                  id="reset-confirm"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="Type RESET"
                  className="w-36"
                />
                <Button
                  variant="destructive"
                  disabled={busy !== "" || confirmation !== "RESET"}
                  title={confirmation !== "RESET" ? "Type RESET to enable" : undefined}
                  onClick={() =>
                    void run("reset", async () => {
                      const message = await resetInventoryFn({ data: { confirmation } });
                      setConfirmation("");
                      return message;
                    })
                  }
                >
                  {busy === "reset" && <Loader2 className="size-4 animate-spin" />}
                  <Trash2 /> Reset
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* 3 — People ------------------------------------------------------- */}
      <Panel className="mb-5">
        <PanelHead
          icon={Users}
          title="Access control"
          note="Admin inherits every Inventory Manager permission. You cannot change or delete your own account."
          action={
            <div className="flex flex-wrap gap-2 text-xs">
              {ROLES.map((role) => (
                <span key={role} className="rounded-full border border-border px-2 py-0.5">
                  {role} · {data.roles[role] ?? 0}
                </span>
              ))}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-muted/45 text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Email
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Joined
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Role
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((row) => {
                const isSelf = row.id === user?.id;
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">
                      {row.name}
                      {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.email}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {row.createdAt}
                    </td>
                    <td className="px-4 py-3">
                      <label className="sr-only" htmlFor={`role-${row.id}`}>
                        Role for {row.name}
                      </label>
                      <select
                        id={`role-${row.id}`}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                        value={row.role}
                        disabled={isSelf || busy !== ""}
                        title={isSelf ? "You cannot change your own role" : undefined}
                        onChange={(event) =>
                          void run(`role-${row.id}`, () =>
                            setUserRoleFn({
                              data: { userId: row.id, role: event.target.value as Role },
                            }),
                          )
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span title={isSelf ? "You cannot delete your own account" : undefined}>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSelf || busy !== ""}
                          onClick={() =>
                            void run(`delete-${row.id}`, () =>
                              deleteUserFn({ data: { userId: row.id } }),
                            )
                          }
                        >
                          <Trash2 /> Remove
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 4 — Runtime ------------------------------------------------------ */}
      <Panel>
        <PanelHead
          icon={ServerCog}
          title="Runtime"
          note="Facts worth checking before a demo or a deployment."
        />
        <div className="space-y-4 p-4">
          {data.environment.otpExposed && (
            <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-subtle p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Password reset codes are returned to the browser.</p>
                <p className="mt-1 text-xs">
                  No mail provider is configured, so the OTP is sent back in the response to make
                  the flow testable. This must not ship to production — wire up email first.
                </p>
              </div>
            </div>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Environment</dt>
              <dd className="mt-0.5 font-medium">{data.environment.nodeEnv}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Database host</dt>
              <dd className="mt-0.5 truncate font-medium" title={data.environment.databaseHost}>
                {data.environment.databaseHost}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Session cookie</dt>
              <dd className="mt-0.5 font-medium">{data.environment.sessionCookie}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Unused reset codes</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{data.pendingResetCodes}</dd>
            </div>
          </dl>
        </div>
      </Panel>
    </>
  );
}
