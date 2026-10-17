import type { ReactNode } from "react";

/** The primary home action: a question answered from saved knowledge. */
export function Hero({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[980px] flex-col items-center px-6 text-center sm:px-10">
      <h1 className="hero-title font-serif text-ink">
        <span className="block">
          Ask your
        </span>
        <span className="block"><span className="hero-mark">knowledge base</span>.</span>
      </h1>
      <p className="home-answer-dek">Find answers in the posts, articles and documents you’ve saved—with citations back to the source.</p>
      {children}
    </section>
  );
}
