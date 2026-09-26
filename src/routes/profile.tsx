import { createFileRoute } from '@tanstack/react-router';
import { PageHead } from '@/components/stock-shell';
import { Profile } from '@/components/stock-pages';
export const Route = createFileRoute('/profile')({ head: () => PageHead('My Profile', 'View inventory workspace profile.'), component: () => <Profile/> });
