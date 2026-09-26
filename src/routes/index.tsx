import { createFileRoute } from "@tanstack/react-router";
import { PageHead } from "@/components/stock-shell";
import { Dashboard } from "@/components/stock-pages";
export const Route = createFileRoute("/")({
  head: () => PageHead("Dashboard", "Inventory dashboard and recent operations."),
  component: () => <Dashboard />,
});
