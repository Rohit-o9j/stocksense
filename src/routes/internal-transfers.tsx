import { createFileRoute } from "@tanstack/react-router";
import { PageHead } from "@/components/stock-shell";
import { OperationList } from "@/components/stock-pages";
export const Route = createFileRoute("/internal-transfers")({
  head: () => PageHead("Internal Transfers", "Track stock moving between locations."),
  component: () => <OperationList kind="Internal Transfer" />,
});
