import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // Externalize roughjs + perfect-freehand so they stay separate
  // imports the consumer bundler can lazy-load. Avoids inlining ~80KB
  // into core for users who never set roughness > 0.
  external: ['roughjs', 'perfect-freehand', 'signia'],
})
