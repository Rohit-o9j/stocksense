import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { ReceiptDetail } from '@/components/stock-pages';
export const Route = createFileRoute('/receipts/$id')({ head: () => PageHead('Receipt Detail','Review and validate an incoming stock receipt.'), component: () => { const { id } = Route.useParams(); return <ReceiptDetail id={id}/> } });
