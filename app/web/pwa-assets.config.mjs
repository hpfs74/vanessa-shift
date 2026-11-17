import { defineConfig, minimal2023Preset as p } from '@vite-pwa/assets-generator/config';
const pieno = { padding: 0, resizeOptions: { background: '#1F3A5F' } };
export default defineConfig({
  preset: { ...p, transparent: { ...p.transparent, padding: 0 }, maskable: { ...p.maskable, ...pieno }, apple: { ...p.apple, ...pieno } },
  images: ['public/icona.svg'],
});
