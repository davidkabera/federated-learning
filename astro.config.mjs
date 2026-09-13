// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import { LikeC4VitePlugin } from 'likec4/vite-plugin';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Federated Learning Lab',
			description:
				'Documentation for distributed federated learning on a Talos Linux Kubernetes cluster.',
			favicon: '/favicon.svg',
			customCss: ['./src/styles/docs.css'],
			sidebar: [
				{
					label: 'Start here',
					items: [{ label: 'Overview', slug: '' }],
				},
				{
					label: 'Lab documentation',
					items: [
						{ label: 'Part 1 — Infrastructure', slug: 'infrastructure' },
						{ label: 'Part 2 — FL Pipeline', slug: 'fl-pipeline' },
						{
							label: 'Architecture',
							items: [
								{ label: 'Cluster and pipeline', slug: 'architecture' },
								{ label: 'Talos cluster', slug: 'architecture/talos' },
								{ label: 'Kubernetes workloads', slug: 'architecture/workloads' },
							],
						},
						{ label: 'CNN vs Federated Learning', slug: 'cnn-vs-fl' },
					],
				},
			],
		}),
		react(),
	],
	vite: {
		plugins: [
			LikeC4VitePlugin({
				workspace: 'src/likec4',
				watch: false,
			}),
		],
	},
});
