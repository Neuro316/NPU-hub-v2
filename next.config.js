/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The middleware matcher skips some /api paths, so it cannot refuse them on the lead device
  // origin. Redirects run first, so no Hub API is reachable from start.neuroprogeny.com.
  async redirects() {
    return [{
      source: '/api/:path*',
      has: [{ type: 'host', value: 'start.neuroprogeny.com' }],
      destination: '/',
      permanent: false,
    }]
  },
  experimental: {
    // Resource Library thumbnails (src/lib/resources/thumb-render.ts) render server-side
    // with pdfjs-dist and @napi-rs/canvas. Both stay as node_modules at runtime rather
    // than bundled: canvas is a native binary, and pdfjs loads its worker module itself.
    serverComponentsExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
    // pdfjs reads its font, character map and image decoder data from disk; the file
    // tracer cannot see those reads, so they are included by name in the function that
    // renders.
    outputFileTracingIncludes: {
      '/api/resources/thumbnail': [
        './node_modules/pdfjs-dist/standard_fonts/**',
        './node_modules/pdfjs-dist/cmaps/**',
        './node_modules/pdfjs-dist/wasm/**',
      ],
    },
  },
}

module.exports = nextConfig
