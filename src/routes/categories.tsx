import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { Categories } from '@/components/stock-pages';
export const Route = createFileRoute('/categories')({ head: () => PageHead('Categories', 'Product categories and counts.'), component: () => <Categories/> });
