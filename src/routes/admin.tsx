import { createFileRoute } from '@tanstack/react-router';

import { PageHead } from '@/components/stock-shell';
import { AdminPage } from '@/components/admin-page';

export const Route = createFileRoute('/admin')({
  head: () => PageHead('Admin', 'System health, demonstration data and access control.'),
  component: AdminPage,
});
