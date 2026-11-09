import type { PostPlatform } from "@/lib/post-production/types";

export function PostPlatformIcons({ platforms }: { platforms: PostPlatform[] }) {
  return <span className="write-platform-icons" role="img" aria-label={platforms.map(platform => platform === "x" ? "X" : "LinkedIn").join(" + ")}>
    {platforms.map(platform => <span className={`write-platform-icon write-platform-icon-${platform}`} key={platform} title={platform === "x" ? "X" : "LinkedIn"}>
      {platform === "x" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.5L1 2h6.5l4.8 6.8L18.9 2Zm-1.1 18h1.7L6.5 3.9H4.7L17.8 20Z" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="3" fill="currentColor" /><path fill="#fff" d="M5 9h3v10H5V9Zm1.5-5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5ZM10 9h2.9v1.4h.1c.4-.8 1.4-1.7 2.9-1.7 3.1 0 3.6 2 3.6 4.6V19h-3v-5.1c0-1.2 0-2.7-1.7-2.7s-1.9 1.3-1.9 2.6V19H10V9Z" /></svg>}
    </span>)}
  </span>;
}
