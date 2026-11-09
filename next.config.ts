import type { NextConfig } from "next";

const pdfRuntimeAssets = ["./server/pdf-worker.mjs", "./node_modules/@llamaindex/liteparse-wasm/package.json", "./node_modules/@llamaindex/liteparse-wasm/pkg/*.js", "./node_modules/@llamaindex/liteparse-wasm/pkg/*.wasm"];

const postFrameworkAssets = ["./frameworks/**/*.yaml", "./frameworks/schema.json"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["linkedom"],
  outputFileTracingIncludes: {
    "/api/write": postFrameworkAssets,
    "/api/processing": pdfRuntimeAssets,
    "/api/cron/processing": pdfRuntimeAssets,
    "/mcp": [...pdfRuntimeAssets, ...postFrameworkAssets],
    "/mcp/*": [...pdfRuntimeAssets, ...postFrameworkAssets],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
