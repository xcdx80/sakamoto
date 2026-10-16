import { ImageResponse } from "next/og";

export const alt = "Sakamoto: highlight any line, ask it anything.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function SocialImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: "#f6f3ec", color: "#1d1b18" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: 40, marginBottom: "64px" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M3 6.5h10.5M3 11.5h10.5M3 16.5h6.5" stroke="#1d1b18" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M18.5 3v18" stroke="#1d1b18" strokeWidth="1.1" strokeLinecap="round" opacity="0.32" />
            <circle cx="18.5" cy="11.5" r="2.9" fill="#c1401b" />
          </svg>
          Sakamoto
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, lineHeight: 1.12, letterSpacing: "-3px" }}>
          <span>Highlight any line.</span>
          <span style={{ color: "#c1401b" }}>Ask it anything.</span>
        </div>
        <div style={{ fontSize: 24, color: "#686258", marginTop: "40px" }}>Your library. Your notes. Answers with sources.</div>
      </div>
    ),
    size,
  );
}
