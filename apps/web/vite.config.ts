import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ root: here, publicDir: false, build: { outDir: 'dist', emptyOutDir: true }, server: { port: 5173 } });
