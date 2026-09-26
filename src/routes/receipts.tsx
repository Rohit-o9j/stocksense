import { Outlet, createFileRoute } from "@tanstack/react-router";
import { PageHead } from "@/components/stock-shell";
import { ReceiptList } from "@/components/stock-pages";
export const Route = createFileRoute("/receipts")({
  head: () => PageHead("Receipts", "Track incoming inventory receipts."),
  component: () => <Outlet />,
});
