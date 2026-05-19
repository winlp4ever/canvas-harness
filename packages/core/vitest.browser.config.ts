import { defineConfig } from 'vitest/config'

export default defineConfig({
  optimizeDeps: {
    include: ['signia'],
  },
  test: {
    include: ['tests/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
  },
})
