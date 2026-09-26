import { createFileRoute } from "@tanstack/react-router";

import { PageHead } from "@/components/stock-shell";
import { ReceiptDetail } from "@/components/stock-pages";

/**
 * Named and capitalised so the react-hooks lint rule recognises this as a
 * component; `Route.useParams()` is a hook and cannot be called from an
 * anonymous arrow passed to `component`.
 */
function ReceiptDetailRoute() {
  const { id } = Route.useParams();
  return <ReceiptDetail id={id} />;
}

export const Route = createFileRoute("/receipts/$id")({
  head: () => PageHead("Receipt Detail", "Review and validate an incoming stock receipt."),
  component: ReceiptDetailRoute,
});
