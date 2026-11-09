import { WritingLink as Link } from "./WritingLink";
import { ArrowRight, Plus, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import type { Production, ProductionBrief, WeeklyIdea } from "@/lib/post-production/types";
import { postSummary } from "@/lib/post-production/post-summary";
import { PostPlatformIcons } from "./PostPlatformIcons";
import { ease, spring } from "@/components/motion/tokens";

const TILT = [-1.4, 0.9, -0.6, 1.3];

export function PostsOverview({ posts, ideas, busy, onStart, onOpen, onSuggest, onDismissIdeas }: {
  posts: Production[]; ideas: WeeklyIdea[] | null; busy: boolean;
  onStart: (brief?: ProductionBrief) => void; onOpen: (id: string) => void;
  onSuggest: () => void; onDismissIdeas: () => void;
}) {
  return <>
    <section className="write-start"><div><h2>Start a post</h2><p>Choose a topic, add direction, then review your draft.</p></div><button className="write-button write-primary" disabled={busy} onClick={() => onStart()}><Plus size={16} />New post</button></section>
    <section className="write-posts" aria-labelledby="posts-title"><header className="write-posts-header"><h2 id="posts-title">Posts <span className="write-count">{posts.length}</span></h2><div><Link href="/calendar" writingState={{busy,dirty:false}} className="write-button write-quiet">Calendar <ArrowRight size={14} /></Link><button className="write-button write-quiet" disabled={busy} onClick={onSuggest}><Sparkles size={15} />Suggest ideas</button></div></header>
      {ideas && <div className="write-ideas"><div className="write-section-head"><h3>Ideas for this week</h3><button className="write-icon-button" aria-label="Dismiss weekly ideas" onClick={onDismissIdeas}><X size={16} /></button></div>{ideas.length ? <div className="write-idea-grid">{ideas.map((idea, index) => <motion.article className="write-idea" key={index} initial={{ opacity: 0, y: 34, rotate: TILT[index % 4] * 5 }} animate={{ opacity: 1, y: 0, rotate: TILT[index % 4] }} whileHover={{ rotate: 0, y: -4 }} transition={{ ...spring.soft, delay: Math.min(index, 7) * 0.06 }}><h3>{idea.brief.idea}</h3><p>{idea.reason}</p>{idea.warnings.map(warning => <p className="write-warning" key={warning}>{warning}</p>)}<button className="write-text-button" disabled={busy} onClick={() => onStart(idea.brief)}>Develop this idea <ArrowRight size={14} /></button></motion.article>)}</div> : <p>No ideas are available yet. Add saved sources or start with your own topic.</p>}</div>}
      {posts.length ? <ul className="write-post-list">{posts.map((post, index) => { const summary = postSummary(post); return <motion.li key={post.id} initial={index < 8 ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: ease.out, delay: index * 0.04 }}><button className="write-post-row" disabled={busy} onClick={() => onOpen(post.id)}><div className="write-post-row-content"><h3 title={post.brief.idea}>{post.brief.idea}</h3><div className="write-post-row-meta"><PostPlatformIcons platforms={post.brief.platforms} /><span>{summary.pillar}</span>{summary.date && <time dateTime={post.plannedAt!}>{summary.date}</time>}</div></div><span className={`write-status write-status-${post.status}`}>{summary.status}</span><ArrowRight size={15} aria-hidden="true" /></button></motion.li>; })}</ul> : <div className="write-posts-empty"><svg viewBox="0 0 120 84" aria-hidden><rect x="34" y="6" width="56" height="72" rx="2" fill="var(--bg-raised)" stroke="var(--rule-strong)" /><path d="M44 22c5-5 8 4 13 0s7-4 13 0" fill="none" stroke="var(--rubric)" strokeWidth="1.8" strokeLinecap="round" /></svg><p>No posts yet. Start with a topic above.</p></div>}
    </section>
  </>;
}
