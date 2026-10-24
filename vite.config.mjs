import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'src/renderer',base:'./',plugins:[react()],build:{outDir:'../../dist/renderer',emptyOutDir:true,rollupOptions:{input:{main:'src/renderer/index.html',modelPreview:'src/renderer/model-preview.html'}}}});
