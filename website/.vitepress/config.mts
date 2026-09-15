import { defineConfig } from 'vitepress';
import apiSidebar from '../api/typedoc-sidebar.json';

const site = 'https://qwertymuzaffar.github.io/ngx-transformers/';
const repo = 'https://github.com/qwertymuzaffar/ngx-transformers';
const description =
  'On-device ML for Angular: Transformers.js with a signals API. Text and zero-shot classification, embeddings and semantic search, translation, and Whisper speech-to-text in the browser. No server, no API key.';

export default defineConfig({
  title: 'ngx-transformers',
  description,
  base: '/ngx-transformers/',
  lastUpdated: false,
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/ngx-transformers/favicon.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'ngx-transformers' }],
    ['meta', { property: 'og:title', content: 'ngx-transformers: on-device ML for Angular' }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: site }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: 'ngx-transformers: on-device ML for Angular' }],
    ['meta', { name: 'twitter:description', content: description }],
  ],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
      {
        text: 'Demos',
        items: [
          { text: 'In the docs', link: '/guide/demos' },
          { text: 'Demo app', link: '/demo/', target: '_self' },
          { text: 'Storybook', link: '/storybook/', target: '_self' },
        ],
      },
      { text: 'Changelog', link: '/changelog' },
      { text: 'npm', link: 'https://www.npmjs.com/package/ngx-transformers' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Concepts', link: '/guide/concepts' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Models', link: '/guide/models' },
          ],
        },
        {
          text: 'Tasks',
          items: [
            { text: 'Text classification', link: '/guide/text-classification' },
            { text: 'Zero-shot classification', link: '/guide/zero-shot' },
            { text: 'Embeddings and semantic search', link: '/guide/embeddings' },
            { text: 'Translation', link: '/guide/translation' },
            { text: 'Speech to text', link: '/guide/speech-to-text' },
            { text: 'Any pipeline', link: '/guide/any-pipeline' },
          ],
        },
        {
          text: 'More',
          items: [
            { text: 'Testing', link: '/guide/testing' },
            { text: 'Demos', link: '/guide/demos' },
          ],
        },
      ],
      '/api/': apiSidebar,
    },
    editLink: {
      // Serialised for the client, so no references to module-level constants here.
      pattern: ({ filePath }) =>
        filePath.startsWith('api/')
          ? 'https://github.com/qwertymuzaffar/ngx-transformers/tree/main/projects/ngx-transformers/src/lib'
          : `https://github.com/qwertymuzaffar/ngx-transformers/edit/main/website/${filePath}`,
      text: 'Edit this page on GitHub',
    },
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    footer: {
      message:
        'MIT licensed. Models come from the Hugging Face Hub under their own licenses; check the one you ship.',
      copyright: 'Copyright 2026 Muzaffar Qosimov',
    },
    outline: { level: [2, 3] },
  },
});
