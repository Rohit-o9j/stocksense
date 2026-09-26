import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { AdjustmentSheet } from '@/components/stock-pages';
export const Route = createFileRoute('/inventory-adjustments')({ head: () => PageHead('Inventory Adjustments', 'Count inventory and apply stock adjustments.'), component: () => <AdjustmentSheet/> });
