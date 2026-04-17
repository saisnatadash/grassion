import type { APIRoute } from 'astro'

const PATHS = ['/', '/about/', '/pricing/', '/contact/', '/privacy/', '/terms/']

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://grassion.com')).origin
  const today = new Date().toISOString().slice(0, 10)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PATHS.map(
    (p) => `  <url><loc>${origin}${p}</loc><lastmod>${today}</lastmod></url>`,
  ).join('\n')}
</urlset>`
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  })
}
