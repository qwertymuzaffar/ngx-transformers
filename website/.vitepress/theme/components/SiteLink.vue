<script setup lang="ts">
import { withBase } from 'vitepress';

// A same-tab link to a non-VitePress path under the site base (the demo app,
// Storybook). Markdown links with {target="_self"} skip the base entirely.
defineProps<{ to: string }>();
</script>

<template>
  <a :href="withBase(to)" target="_self"><slot /></a>
</template>
