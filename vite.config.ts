import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version?: string };

function env(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function gitSha(): string | undefined {
  try {
    return execSync('git rev-parse --short=12 HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

const appVersion = pkg.version ?? env(['APP_VERSION', 'npm_package_version']) ?? '0.0.0';
const appBuildDate = env(['APP_BUILD_DATE', 'BUILD_DATE']) ?? new Date().toISOString();
const appBuildId = env([
  'APP_BUILD_ID',
  'APP_BUILD_NUMBER',
  'BUILD_NUMBER',
  'GITHUB_RUN_NUMBER',
  'RENDER_BUILD_ID',
  'RENDER_GIT_COMMIT',
  'VERCEL_GIT_COMMIT_SHA',
  'CF_PAGES_COMMIT_SHA',
]) ?? gitSha() ?? appBuildDate.replace(/[-:TZ.]/g, '').slice(0, 12);
const devServerPort = Number(env(['DEV_SERVER_PORT', 'VITE_DEV_SERVER_PORT']) ?? '5173');
const devApiOrigin = env(['DEV_API_ORIGIN', 'VITE_DEV_API_ORIGIN']) ?? 'http://127.0.0.1:8787';
const devWsOrigin = env(['DEV_WS_ORIGIN', 'VITE_DEV_WS_ORIGIN']) ?? devApiOrigin.replace(/^http/, 'ws');

// Pretty-URL aliases for the standalone official-channels page (public/links.html).
// Mirrors the production server's rewrite in server/main.ts (LINKS_ALIASES) so the
// same /links, /social, /social-media-links paths resolve in dev and preview too.
const LINKS_ALIASES = new Set([
  '/links', '/links/', '/social', '/social/', '/social-media-links', '/social-media-links/',
]);
function linksAliasPlugin() {
  const rewrite = (req: { url?: string }) => {
    const url = req.url ?? '';
    const pathOnly = url.split('?')[0];
    if (LINKS_ALIASES.has(pathOnly)) req.url = '/links.html' + url.slice(pathOnly.length);
  };
  const attach = (server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, _res, next) => { rewrite(req); next(); });
  };
  return { name: 'woc-links-alias', configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig({
  base: '/',
  plugins: [linksAliasPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_ID__: JSON.stringify(appBuildId.slice(0, 12)),
    __APP_BUILD_DATE__: JSON.stringify(appBuildDate),
  },
  // Parent dir has a postcss.config.js with Tailwind — ignore it; this project has no CSS pipeline.
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    port: devServerPort,
    proxy: {
      '/api': { target: devApiOrigin, changeOrigin: true },
      '/admin/api': { target: devApiOrigin, changeOrigin: true },
      '/ws': { target: devWsOrigin, ws: true },
      // MediaWiki community wiki runs as its own container on :8080. Proxy /wiki*
      // to it so the in-app "Browse the Wiki" link resolves in dev too — mirrors
      // the prod reverse-proxy route (nginx /wiki -> :8080). Needs the container
      // up: `docker compose up -d mediawiki mediawiki-db`.
      '/wiki': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
      },
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
