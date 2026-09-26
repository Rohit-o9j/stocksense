import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { MoveHistory } from '@/components/stock-pages';
export const Route = createFileRoute('/move-history')({ head: () => PageHead('Move History', 'Search all stock movements and inventory ledger entries.'), component: () => <MoveHistory/> });
