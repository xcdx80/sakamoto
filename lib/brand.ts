/** The public product name. */
export const BRAND = {
  name: "InView",
} as const;

/** The generated social card uses InView's current branding. */
export const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "InView: Bring what you’ve read back into view." };

/** The public origin, for canonical, sitemap and social card URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3100");

/** Named user agent for public source retrieval. */
export const APP_UA = "InView/0.1";
