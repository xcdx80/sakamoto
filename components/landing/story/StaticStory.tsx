/* eslint-disable @next/next/no-img-element */
"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { SAMPLE_SHELF } from "@/lib/classics";
import { Colophon } from "./Colophon";
import { ANSWER, CLOSE_LINE, DRAFT, LIBRARY_SENTENCE, QUESTION, SOURCES, samplesForChips } from "./copy";

/** The whole story, standing still, for readers who prefer no motion. */
export function StaticStory() {
  return (
    <>
      <div className="story-static">
        <section>
          <p className="sk-eyebrow">Posts, tabs, screenshots, PDFs</p>
          <h2 className="sk-display story-h">Highlight any line.</h2>
          <p className="story-prose"><mark>{LIBRARY_SENTENCE}</mark></p>
        </section>
        <section>
          <h2 className="sk-display story-h">Ask it anything.</h2>
          <div className="story-answer">
            <p className="story-question">{QUESTION}</p>
            <p className="story-answer-text">
              {ANSWER.map((part, i) => typeof part === "string" ? <span key={i}>{part}</span> : <b key={i} className="story-cite on">{part.cite}</b>)}
            </p>
          </div>
          <ul className="story-static-sources">
            {SOURCES.filter((s) => s.n).map((s) => <li key={s.n}><b>{s.n}</b> {s.title}, {s.by}</li>)}
          </ul>
        </section>
        <section>
          <h2 className="sk-display story-h">Go to the source.</h2>
          <p className="story-static-foot">Every claim links to the passage behind it.</p>
        </section>
        <section>
          <h2 className="sk-display story-h">Then write something.</h2>
          <article className="story-draft is-static"><p>{DRAFT}</p></article>
          <p className="story-static-foot">Planned, not posted. Publishing stays your call.</p>
        </section>
      </div>
      <div className="story-static-close">
        <h2 className="sk-display">{CLOSE_LINE}</h2>
        <SignInButton mode="modal"><button type="button" className="sk-btn story-close-cta">Sign in</button></SignInButton>
        <div className="story-close-try">
          <span>No link handy? Try</span>
          {samplesForChips().map((a) => (
            <Link key={a.id} href={`/read/${a.id}`} className="story-close-chip">
              <img src={SAMPLE_SHELF[a.id]?.cover} alt="" draggable={false} />
              {a.author?.split(" ").slice(-1)[0]}
            </Link>
          ))}
        </div>
      </div>
      <Colophon />
    </>
  );
}
