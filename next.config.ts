import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {},
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },

  // NOTE: The WebSocket rewrite to the Gemini API has been moved to
  // src/proxy.ts so the API key is resolved at REQUEST TIME (runtime),
  // never interpolated into static build artifacts under .next/.
  // See: CRIT-01 in SecurityAudit.md

  async headers() {
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
      : "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'";

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' is required by Next.js for hydration scripts and Tailwind CSS.
              // 'wasm-unsafe-eval' allows WASM execution (RNNoise) without enabling full eval().
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "media-src 'self' blob:",
              "connect-src 'self' ws: wss: https://*.livekit.cloud wss://*.livekit.cloud",
              "worker-src 'self' blob:",
            ].join("; "),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Permissions-Policy",
            value: "microphone=(self), camera=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
