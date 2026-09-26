import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { OperationList } from '@/components/stock-pages';
export const Route = createFileRoute('/delivery-orders')({ head: () => PageHead('Delivery Orders', 'Track outgoing inventory deliveries.'), component: () => <OperationList kind="Delivery"/> });
