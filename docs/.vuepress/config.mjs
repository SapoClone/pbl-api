import { viteBundler } from '@vuepress/bundler-vite';
import { searchPlugin } from '@vuepress/plugin-search';
import { defaultTheme } from '@vuepress/theme-default';
import { defineUserConfig } from 'vuepress';
import { mdEnhancePlugin } from 'vuepress-plugin-md-enhance';
import { markdownImagePlugin } from '@vuepress/plugin-markdown-image';
import { markdownTabPlugin } from '@vuepress/plugin-markdown-tab';
import { en as enThemeConfig } from './config/theme/en.config.mjs';
import { vi as viThemeConfig } from './config/theme/vi.config.mjs';

export default defineUserConfig({
  lang: 'en-US',
  title: 'NestJS boilerplate',
  description: 'NestJS boilerplate with best practices',
  // GitHub Pages serves this repository at https://sapoclone.github.io/pbl-api/ (set DOCS_BASE to build for another path)
  base: process.env.DOCS_BASE ?? '/pbl-api/',
  bundler: viteBundler(),
  markdown: {
    toc: {
      level: [2, 3, 4, 5],
    },
  },
  locales: {
    '/': {
      lang: 'en-US',
      title: 'NestJS boilerplate 🎉',
    },
    '/vi/': {
      lang: 'vi-VN',
      title: 'NestJS boilerplate 🎉',
    },
  },
  theme: defaultTheme({
    repo: 'vndevteam/nestjs-boilerplate',
    docsBranch: 'main',
    docsDir: 'docs',
    locales: {
      '/': enThemeConfig,
      '/vi/': viThemeConfig,
    },
  }),
  plugins: [
    searchPlugin({
      maxSuggestions: 15,
      hotKeys: ['s', '/'],
      locales: {
        '/': {
          placeholder: 'Search',
        },
        '/vi/': {
          placeholder: 'Tìm kiếm',
        },
      },
    }),
    // guides: https://plugin-md-enhance.vuejs.press/guide/
    mdEnhancePlugin({
      tasklist: true,
      align: true,
    }),
    markdownImagePlugin({
      figure: true,
      lazyload: true,
      mark: true,
      size: true,
    }),
    markdownTabPlugin({
      codeTabs: true,
      tabs: true,
    }),
  ],
});
