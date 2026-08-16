import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

/**
 * Puts pdf.js's worker where the browser can fetch it.
 *
 * pdf.js runs its parser in a Web Worker and needs a URL to load it from.
 * The usual trick — `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
 * import.meta.url)` — relies on the bundler rewriting a BARE specifier inside
 * `new URL`, which bundlers do for relative paths and not reliably for package
 * names. When it is not rewritten the build still succeeds and the URL resolves
 * against the chunk path at runtime, so it 404s and every PDF silently fails to
 * render. Copying the file to `public/` and asking for it by an absolute path
 * cannot fail that way.
 *
 * Copied rather than committed, so the worker can never drift from the
 * `pdfjs-dist` version in package.json — a mismatched pair fails in confusing
 * ways. `predev` and `prebuild` run this, and the output is gitignored.
 *
 * `.js` rather than `.mjs`: the worker is loaded with `{ type: 'module' }`
 * either way, and `.js` is the extension every static host is certain to serve
 * with a JavaScript content type.
 */

const source = 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
const destination = 'public/pdf.worker.min.js';

if (!existsSync(source)) {
  throw new Error(
    `${source} is missing. Run \`npm install\` before building — pdfjs-dist supplies the resume viewer's worker.`,
  );
}

mkdirSync('public', { recursive: true });
copyFileSync(source, destination);
console.log(`copied ${source} -> ${destination}`);
