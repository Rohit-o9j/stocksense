import { createFileRoute } from "@tanstack/react-router";

import { PageHead } from "@/components/stock-shell";
import { ProductDetail } from "@/components/stock-pages";

/**
 * Named and capitalised so the react-hooks lint rule recognises this as a
 * component; `Route.useParams()` is a hook and cannot be called from an
 * anonymous arrow passed to `component`.
 */
function ProductDetailRoute() {
  const { id } = Route.useParams();
  return <ProductDetail id={id} />;
}

export const Route = createFileRoute("/products/$id")({
  head: () => PageHead("Product Detail", "Product availability and movement history."),
  component: ProductDetailRoute,
});
