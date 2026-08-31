// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Project page: served from https://getperch.github.io/perch/
// The marketing landing page is docs/src/pages/index.html — Astro serves .html files
// in src/pages/ as routes, so it is the site root (/). Starlight docs live under
// /perch/docs/ because their content files sit in src/content/docs/docs/.
export default defineConfig({
	site: 'https://getperch.github.io',
	base: '/perch',
	integrations: [
		starlight({
			title: 'perch',
			description: 'Design notes, plans, and architecture references for perch.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/getperch/perch' },
			],
			sidebar: [
				{ label: 'Landing page', link: '/' },
				{ label: 'Docs', items: [{ autogenerate: { directory: 'docs' } }] },
			],
		}),
	],
});
