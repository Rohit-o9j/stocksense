import { createFileRoute } from "@tanstack/react-router";
import { PageHead } from "@/components/stock-shell";
import { ReorderingRules } from "@/components/stock-pages";
export const Route = createFileRoute("/reordering-rules")({
  head: () => PageHead("Reordering Rules", "Review minimum stock and suggested orders."),
  component: () => <ReorderingRules />,
});
