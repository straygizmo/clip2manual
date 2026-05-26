import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  // Node/native dependencies (e.g. uiohook-napi) MUST stay external. Bundling them breaks
  // node-gyp-build's prebuild resolution at runtime: it loads the .node binary relative to
  // the package dir in node_modules, not the bundle output (`out/`). externalizeDepsPlugin
  // keeps `dependencies` as runtime requires.
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()],
  },
});
