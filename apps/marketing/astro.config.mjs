import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'

const SITE = process.env.MARKETING_URL || 'https://grassion.com'

// https://astro.build/config
export default defineConfig({
  site: SITE,
  integrations: [tailwind({ applyBaseStyles: false })],
  build: {
    format: 'directory',
  },
  server: {
    port: 4321,
  },
})
