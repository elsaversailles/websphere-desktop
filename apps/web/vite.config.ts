import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ root: here, publicDir: fileURLToPath(new URL('./public', import.meta.url)), build: { outDir: 'dist', emptyOutDir: true }, server: { port: 5173 } });
