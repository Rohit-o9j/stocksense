import { createFileRoute } from '@tanstack/react-router';
import { AuthPage } from '@/components/auth-page';
import { PageHead } from '@/components/stock-shell';

export const Route = createFileRoute('/auth')({
  head: () => PageHead('Sign in', 'StockSense account sign-in design preview.'),
  component: AuthPage,
});