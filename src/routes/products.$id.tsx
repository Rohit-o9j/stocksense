import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { ProductDetail } from '@/components/stock-pages';
export const Route = createFileRoute('/products/$id')({ head: () => PageHead('Product Detail','Product availability and movement history.'), component: () => { const { id } = Route.useParams(); return <ProductDetail id={id}/> } });
