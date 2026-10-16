/** Every outbound URL in one place. */
export const BRAND = {
  name: "Sakamoto",
  keysUrl: "https://api.together.ai/settings/api-keys",
} as const;


/** The generated social card uses Sakamoto's current branding. */
export const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Sakamoto: highlight any line, ask it anything." };

/** The public origin, for canonical, sitemap and social card URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3100");
