import { defineConfig } from 'vitest/config'

const config: ReturnType<typeof defineConfig> = defineConfig({
  test: {
    // Response/Headers/FormData/File are all globals on Node >= 20 — no jsdom needed
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts']
    }
  }
})

export default config
