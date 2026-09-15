import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import DemoFrame from './components/DemoFrame.vue';
import SiteLink from './components/SiteLink.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DemoFrame', DemoFrame);
    app.component('SiteLink', SiteLink);
  },
} satisfies Theme;
