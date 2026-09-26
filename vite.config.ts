import { defineConfig, loadEnv } from 'vite';
import { jevProxy } from './server/jevProxy';

export default defineConfig(({ mode }) => {
  // Empty prefix loads non-VITE_ vars too. They are used only here (server side) and never
  // passed to `define`, so the key cannot end up in the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: { port: 5173 },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
    plugins: [
      jevProxy({
        apiKey: env.JEV_API_KEY,
        model: env.JEV_MODEL || 'jev-latest',
        baseUrl: env.JEV_BASE_URL || 'https://api.typesafe.ai',
      }),
    ],
  };
});
