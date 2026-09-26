import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { Warehouses } from '@/components/stock-pages';
export const Route = createFileRoute('/warehouses')({ head: () => PageHead('Warehouses & Locations', 'Browse physical and virtual storage locations.'), component: () => <Warehouses/> });
