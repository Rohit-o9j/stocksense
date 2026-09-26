import { Outlet, createFileRoute } from "@tanstack/react-router";
import { PageHead } from "@/components/stock-shell";
import { Products } from "@/components/stock-pages";
export const Route = createFileRoute("/products")({
  head: () => PageHead("Products", "Browse products and stock levels."),
  component: () => <Outlet />,
});
