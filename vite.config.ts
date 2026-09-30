import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'
import { createLogger, defineConfig } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

const logger = createLogger()
const originalWarn = logger.warn.bind(logger)
logger.warn = (msg, options) => {
  if (msg.includes('Failed to load source map')) return
  originalWarn(msg, options)
}

export default defineConfig({
  customLogger: logger,
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [
      'convex/_generated/**',
      'agent/**',
      '.vercel/**',
      '.claude/**',
      'dist/**',
      '.planning/**',
      'app.config.timestamp*.js',
    ],
  },
  staged: {
    '*.{ts,tsx}': ['vp check --fix'],
    '*.{json,md,css}': ['vp fmt'],
  },
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 80,
    sortPackageJson: false,
    ignorePatterns: [
      '.nitro/',
      '.output/',
      '.tanstack/',
      '**/api',
      '**/build',
      '**/public',
      'convex/_generated/',
      'convex/README.md',
      'bun.lock',
      'routeTree.gen.ts',
    ],
  },
  server: {
    proxy: {
      '/ingest': {
        target: 'https://us.i.posthog.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/, ''),
        secure: false,
      },
      '/tunnel': {
        target: 'https://o4510997439053824.ingest.de.sentry.io',
        changeOrigin: true,
        rewrite: () =>
          '/api/4510997440692304/envelope/?sentry_key=f7612c740401feef0039be0728f64cc4',
        secure: false,
      },
    },
  },
  build: {
    sourcemap: 'hidden',
  },
  resolve: {
    tsconfigPaths: true,
    // Force a single React instance across CJS/ESM boundaries during SSR
    // Prevents "Cannot read properties of null (reading 'useEffect')" in server rendering
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ],
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      preset: 'vercel',
    }),
    sentryTanstackStart({
      org: 'baish',
      // The project's slug (its display name is javascript-tanstackstart-react)
      project: 'safetytalentorg',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // A Sentry problem (outage, expired token) must not block a deploy.
      errorHandler: (error) => {
        console.warn('[sentry] source map upload failed:', error.message)
      },
      telemetry: false,
      sourcemaps: {
        filesToDeleteAfterUpload: ['**/*.map'],
      },
    }),
    viteReact({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
})
