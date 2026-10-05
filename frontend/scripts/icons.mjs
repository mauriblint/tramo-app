// Regenerate the app icons from public/logo.svg: `npm run icons`.
// Full-bleed green on every size (iOS and Android round the corners themselves); the maskable
// icon keeps the drawing inside the 80% safe zone so Android's circle/squircle masks don't clip it.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const pub = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url))
const logo = await readFile(pub('logo.svg'), 'utf8')

const GREEN = '#0A7A55'
// The drawing without its background square, so it can be scaled on its own.
const art = logo.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/<rect[^>]*\/>/, '')
const svg = (scale) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${GREEN}"/>` +
      `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g></svg>`,
  )

const out = [
  ['pwa-64x64.png', 64, 1],
  ['pwa-192x192.png', 192, 1],
  ['pwa-512x512.png', 512, 1],
  ['apple-touch-icon-180x180.png', 180, 0.9],
  ['maskable-icon-512x512.png', 512, 0.78],
]
for (const [file, size, scale] of out) {
  await sharp(svg(scale), { density: 300 }).resize(size, size).png().toFile(pub(file))
  console.log('✓', file)
}
