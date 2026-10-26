import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ build: { rollupOptions: { input: { course: fileURLToPath(new URL('./index.html', import.meta.url)), cyber: fileURLToPath(new URL('./cyber.html', import.meta.url)) } } } });
