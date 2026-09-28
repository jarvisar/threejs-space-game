import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Build output the service worker doesn't need to cache. Screenshots, the big
// icons and the social image are only fetched by browsers and link previews,
// and every browser with service workers uses the woff2 fonts.
const NO_CACHE = [/^sw\.js$/, /^screenshots\//, /^icons\//, /^og-image\./, /^robots\.txt$/, /^sitemap\.xml$/, /\.woff$/];

// Writes dist/sw.js from src/sw.js with the list of files to cache. VERSION is a
// hash of those files so any build that changes something gets a new service worker.
function serviceWorker() {
  let root, outDir;
  return {
    name: 'starsong-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => relative(outDir, join(d.parentPath, d.name)).replaceAll('\\', '/'))
        .filter((f) => !NO_CACHE.some((re) => re.test(f)))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const head = `const VERSION = '${hash.digest('hex').slice(0, 12)}';\nconst FILES = ${JSON.stringify(files, null, 2)};\n\n`;
      writeFileSync(join(outDir, 'sw.js'), head + readFileSync(join(root, 'src/sw.js'), 'utf8'));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
