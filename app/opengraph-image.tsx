import { ImageResponse } from "next/og";
import { MARK } from "@/components/brand/mark";

export const alt = "Sakamoto: highlight any line, ask it anything.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function SocialImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: "#faf7f0", color: "#1a1814" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: 40, marginBottom: "64px" }}>
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <rect x={MARK.seal.x} y={MARK.seal.y} width={MARK.seal.size} height={MARK.seal.size} rx={MARK.seal.radius} fill={MARK.ink} />
            <g transform={MARK.tilt} fill={MARK.paper}>{MARK.pages.map((d) => <path key={d} d={d} />)}</g>
            <path d={MARK.slope} stroke={MARK.paper} strokeWidth="1.35" strokeLinecap="round" />
          </svg>
          Sakamoto
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, lineHeight: 1.12, letterSpacing: "-3px" }}>
          <span>Highlight any line.</span>
          <span style={{ color: "#d3431a" }}>Ask it anything.</span>
        </div>
        <div style={{ fontSize: 24, color: "#686258", marginTop: "40px" }}>Your library. Your notes. Answers with sources.</div>
      </div>
    ),
    size,
  );
}
