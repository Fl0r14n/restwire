import { defineConfig } from 'tsdown'

// annotated rather than exported inline: `isolatedDeclarations` cannot infer a default export
const config: ReturnType<typeof defineConfig> = defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  unbundle: false,
  publint: true,
  attw: true
})

export default config
