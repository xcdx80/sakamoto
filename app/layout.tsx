import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, DM_Mono, Literata, Newsreader, Reenie_Beanie, Schibsted_Grotesk } from "next/font/google";
import { BOOT_SCRIPT } from "@/lib/settings";
import "./globals.css";
import "./system.css";
import { MotionRoot } from "@/components/motion/MotionRoot";
import { PageCurtain } from "@/components/motion/PageCurtain";
import { Tooltips } from "@/components/ui/Tooltips";
import { ClerkProvider } from "@clerk/nextjs";
import { AccountLibrary } from "@/components/account/SyncAgent";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";

const serif = Newsreader({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--nf-serif",
  display: "swap",
});

const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--nf-sans",
  display: "swap",
});

const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--nf-mono", display: "swap" });

const hand = Reenie_Beanie({ subsets: ["latin"], weight: "400", variable: "--nf-hand", display: "swap" });

// Optional reading faces: declared here, fetched only when a reader picks them.
const book = Literata({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--nf-book",
  display: "swap",
  preload: false,
});

const legible = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--nf-legible",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const DESCRIPTION = "Ask your knowledge base. Find answers in your saved posts, articles and documents, with citations back to the source.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Sakamoto", template: "%s" },
  description: DESCRIPTION,
  applicationName: "Sakamoto",
  openGraph: { type: "website", siteName: "Sakamoto", title: "Sakamoto", description: DESCRIPTION, url: "/", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: "Sakamoto", description: DESCRIPTION, images: [OG_IMAGE.url] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#151412" },
  ],
};

/** Clerk's sign-in and account screens, in the page's own ink and paper, in every theme. */
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "var(--ink)",
    colorBackground: "var(--bg-raised)",
    colorForeground: "var(--ink)",
    colorMutedForeground: "var(--ink-3)",
    colorInput: "var(--bg)",
    colorInputForeground: "var(--ink)",
    colorBorder: "var(--rule-strong)",
    colorNeutral: "var(--ink)",
    fontFamily: "var(--font-sans)",
    borderRadius: "12px",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable} ${hand.variable} ${book.variable} ${legible.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        <ClerkProvider appearance={CLERK_APPEARANCE}>
          <MotionRoot>
            <AccountLibrary>{children}</AccountLibrary>
            <PageCurtain />
          </MotionRoot>
        </ClerkProvider>
        <Tooltips />
      </body>
    </html>
  );
}
