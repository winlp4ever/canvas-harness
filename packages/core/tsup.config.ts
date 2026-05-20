import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // Externalize roughjs so it stays a separate import that consumer
  // bundlers (Vite, Webpack) can lazy-load. Avoids inlining ~80KB
  // into core for users who never set roughness > 0.
  external: ['roughjs', 'signia'],
})
