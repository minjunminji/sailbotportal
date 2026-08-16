import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // pdf.js's worker, copied into `public/` by scripts/copy-pdf-worker.mjs.
    // Vendor code we neither wrote nor can fix, and 1.2MB of it: linting it
    // buries real findings under 1,500 warnings about minified output.
    'public/pdf.worker.min.js',
  ]),
]);

export default eslintConfig;
