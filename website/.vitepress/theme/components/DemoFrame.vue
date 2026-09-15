<script setup lang="ts">
import { computed, ref } from 'vue';
import { withBase } from 'vitepress';

const demos = [
  { key: 'app', label: 'Demo app', path: '/demo/' },
  { key: 'storybook', label: 'Storybook', path: '/storybook/' },
] as const;
const active = ref<(typeof demos)[number]['key']>('app');
const current = computed(() => demos.find((demo) => demo.key === active.value)!);
</script>

<template>
  <div class="demo-frame">
    <div class="demo-frame__bar">
      <div class="demo-frame__tabs" role="tablist" aria-label="Demo">
        <button
          v-for="demo in demos"
          :key="demo.key"
          type="button"
          role="tab"
          :aria-selected="demo.key === active"
          :class="['demo-frame__tab', { 'is-active': demo.key === active }]"
          @click="active = demo.key"
        >
          {{ demo.label }}
        </button>
      </div>
      <a class="demo-frame__open" :href="withBase(current.path)" target="_blank" rel="noopener">Open full screen ↗</a>
    </div>
    <iframe
      :key="current.key"
      :src="withBase(current.path)"
      :title="current.label"
      loading="lazy"
      allow="microphone; fullscreen"
    ></iframe>
  </div>
</template>

<style scoped>
.demo-frame {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  margin: 16px 0 24px;
}
.demo-frame__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}
.demo-frame__tabs {
  display: flex;
  gap: 4px;
}
.demo-frame__tab {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.demo-frame__tab.is-active {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}
.demo-frame__open {
  font-size: 13px;
  color: var(--vp-c-text-2);
  text-decoration: none;
}
.demo-frame__open:hover {
  color: var(--vp-c-brand-1);
}
iframe {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  border: 0;
  background: #f1f5f9;
}
</style>
