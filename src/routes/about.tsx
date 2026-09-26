import { createFileRoute } from '@tanstack/react-router';

import { AboutPage } from '@/components/about-page';

/**
 * Standalone marketing page. Rendered outside StockShell by the session gate in
 * __root, because AboutPage brings its own header, nav and footer.
 *
 * Head tags are declared inline rather than via PageHead so this public route
 * does not pull the application shell into its bundle.
 */
export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      { title: 'About · StockSense' },
      {
        name: 'description',
        content:
          'StockSense brings products, locations and stock movements into one structured inventory system.',
      },
      { property: 'og:title', content: 'About · StockSense' },
      {
        property: 'og:description',
        content:
          'StockSense brings products, locations and stock movements into one structured inventory system.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: AboutPage,
});
