"use client";

import { useMotionValue, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";
import { SCREENS, useViewport } from "./clock";
import { Colophon } from "./Colophon";
import { Pieces } from "./Pieces";
import { AskScene, CloseScene, GatherCaption, HighlightScene, Sheet, SourceScene, WriteScene } from "./Scenes";
import { StaticStory } from "./StaticStory";

/**
 * The desk, and for people who haven't signed in, the story that plays across it.
 * The hero scrolls up and away over a pinned stage, so the objects you just
 * played with are the same ones that gather into a page.
 */
export function HomeStage({ story, children }: { story: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useViewport();
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  const still = useMotionValue(0);
  const live = story && !reduced;
  // A plain derived value: Motion's native scroll timelines drop easing and hold opacity at 1 before their range.
  const clock = useTransform(scrollYProgress, (v: number) => v);
  const p = live ? clock : still;

  if (!live)
    return (
      <>
        <div ref={track} className="home-desk">
          <div ref={stage} className="home-desk-layer sk-desk">{view && <Pieces view={view} p={p} bounds={stage} />}</div>
          <div className="home-hero-layer">{children}</div>
        </div>
        {story && <StaticStory />}
      </>
    );

  return (
    <>
      <div ref={track} className="story-track" style={{ height: `${(SCREENS + 1) * 100}svh` }}>
        <section ref={stage} className="story-stage sk-desk" aria-label="How InView works">
          {view && (
            <>
              <GatherCaption p={p} />
              <Sheet p={p} view={view} />
              <Pieces view={view} p={p} bounds={stage} />
              <HighlightScene p={p} view={view} />
              <AskScene p={p} view={view} />
              <SourceScene p={p} view={view} />
              <WriteScene p={p} view={view} />
              <CloseScene p={p} />
            </>
          )}
        </section>
        <div className="home-hero-layer">{children}</div>
      </div>
      <Colophon />
    </>
  );
}
