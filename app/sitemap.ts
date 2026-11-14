import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";
import { SAMPLES } from "@/lib/samples";

/** The pages anyone can open: imported texts live in each reader's browser, so only the samples are listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/library`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/privacy` },
    { url: `${SITE_URL}/terms` },
    ...SAMPLES.map((a) => ({ url: `${SITE_URL}/read/${a.id}`, changeFrequency: "yearly" as const, priority: 0.8 })),
  ];
}
