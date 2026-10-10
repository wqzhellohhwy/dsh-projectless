// Build both faces of the plugin:
//   lib/index.js   — Host half, ESM, DSH loads it from package.json `main`.
//   lib/client.js  — Client half, the CJS bundle a DSH page injects inside
//                    `window.__ModuleLoader__.load({ id, factory })`.
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

const ID = 'dsh-projectless'
const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/jsx-runtime', 'node:*'],
}

await mkdir('lib', { recursive: true })

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
})

await build({
  ...shared,
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  // Classic runtime on purpose: the Host page hands plugins `react` through the
  // module loader, and `react/jsx-runtime` is not part of that contract.
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  banner: {
    js: `window.__ModuleLoader__.load({ id: "${ID}", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
})
