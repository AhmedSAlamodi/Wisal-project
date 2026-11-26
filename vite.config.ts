import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(rootDir, 'dist');
          const srcAssets = path.resolve(rootDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
      {
        name: 'prevent-hmr-disconnect-reload',
        apply: 'serve',
        transform(code: string, id: string) {
          if (
            process.env.DISABLE_HMR === 'true' &&
            id.includes('vite/dist/client/client.mjs')
          ) {
            return {
              code: code
                .replace(
                  'if (payload.event === "vite:ws:disconnect") {',
                  'if (false && payload.event === "vite:ws:disconnect") {'
                )
                .replace(
                  'async connect(handlers) {\n\t\t\ttry {\n\t\t\t\tawait wsTransport.connect(handlers);',
                  'async connect(handlers) {\n\t\t\treturn;\n\t\t\ttry {\n\t\t\t\tawait wsTransport.connect(handlers);'
                )
                .replace(
                  'send(data) {\n\t\t\twsTransport.send(data);',
                  'send() {\n\t\t\treturn;'
                ),
              map: null,
            };
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
