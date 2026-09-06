import type { StorybookConfig } from "@storybook/angular";

const config: StorybookConfig = {
  stories: ["../projects/**/*.stories.@(ts|mdx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
  framework: {
    name: "@storybook/angular",
    options: {},
  },
};
export default config;
