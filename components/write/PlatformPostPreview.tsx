"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BarChart3, Bookmark, Globe2, Heart, MessageCircle, MoreHorizontal, Repeat2, Send, ThumbsUp, Upload, UserRound } from "lucide-react";
import { segmentClaims, type ClaimLine } from "@/lib/post-production/claim-marks";
import type { DraftVariant } from "@/lib/post-production/types";
import "@/app/write/platform-preview.css";

export type PlatformPreviewAuthor = {
  name: string;
  handle?: string;
  headline?: string;
  imageUrl?: string;
};

export type PlatformPostPreviewProps = {
  variant: DraftVariant;
  author?: PlatformPreviewAuthor;
  className?: string;
  claims?: ClaimLine[];
  activeSource?: string | null;
  onClaimHover?: (sourceId: string | null) => void;
  onClaimOpen?: (sourceId: string) => void;
};

type ClaimProps = Pick<PlatformPostPreviewProps, "claims" | "activeSource" | "onClaimHover" | "onClaimOpen">;

function Avatar({ author }: { author: PlatformPreviewAuthor }) {
  const [failedImage, setFailedImage] = useState<string>();
  return <span className="platform-preview-avatar" aria-hidden="true">
    <UserRound size={24} strokeWidth={1.6} />
    {author.imageUrl && failedImage !== author.imageUrl && <img src={author.imageUrl} alt="" onError={() => setFailedImage(author.imageUrl)} />}
  </span>;
}

/** Collapse by rendered feed lines, so wrapping follows the actual card width. */
function FeedText({ text, platform, claims, activeSource, onClaimHover, onClaimOpen }: { text: string; platform: DraftVariant["platform"] } & ClaimProps) {
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const visibleLines = platform === "linkedin" ? 3 : 10;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(body).lineHeight);
      setOverflows(body.scrollHeight > lineHeight * visibleLines + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [text, visibleLines]);

  return <div className="platform-preview-copy">
    <p ref={bodyRef} id={id} className={`platform-preview-text${expanded ? " is-expanded" : ""}${text ? "" : " is-empty"}`}>
      {!text ? "Your post will appear here." : !claims?.length ? text : segmentClaims(text, claims).map((segment, index) => segment.sourceIds
        ? <mark key={index} className="platform-preview-claim" data-active={Boolean(activeSource && segment.sourceIds.includes(activeSource))} role="button" tabIndex={0} aria-label={`Show the source for: ${segment.text}`} onMouseEnter={() => onClaimHover?.(segment.sourceIds![0])} onMouseLeave={() => onClaimHover?.(null)} onClick={() => onClaimOpen?.(segment.sourceIds![0])} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClaimOpen?.(segment.sourceIds![0]); } }}>{segment.text}</mark>
        : segment.text)}
    </p>
    {overflows && <button type="button" className="platform-preview-expand" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      {expanded ? "See less" : platform === "linkedin" ? "…see more" : "Show more"}
    </button>}
  </div>;
}

function XActions() {
  return <div className="platform-preview-x-actions" role="group" aria-label="X actions · preview only">
    <span role="img" aria-label="Reply"><MessageCircle aria-hidden="true" /></span>
    <span role="img" aria-label="Repost"><Repeat2 aria-hidden="true" /></span>
    <span role="img" aria-label="Like"><Heart aria-hidden="true" /></span>
    <span role="img" aria-label="Views"><BarChart3 aria-hidden="true" /></span>
    <span className="platform-preview-x-save"><span role="img" aria-label="Bookmark"><Bookmark aria-hidden="true" /></span><span role="img" aria-label="Share"><Upload aria-hidden="true" /></span></span>
  </div>;
}

function LinkedInActions() {
  return <div className="platform-preview-linkedin-actions" role="group" aria-label="LinkedIn actions · preview only">
    <span><ThumbsUp aria-hidden="true" />Like</span>
    <span><MessageCircle aria-hidden="true" />Comment</span>
    <span><Repeat2 aria-hidden="true" />Repost</span>
    <span><Send aria-hidden="true" />Send</span>
  </div>;
}

export function PlatformPostPreview({ variant, author = { name: "Your profile" }, className = "", ...claimProps }: PlatformPostPreviewProps) {
  const platformName = variant.platform === "x" ? "X" : "LinkedIn";
  return <section className={`platform-preview platform-preview-${variant.platform} ${className}`} aria-label={`${platformName} feed preview`}>
    <p className="platform-preview-label">{platformName}<span>Feed preview · Draft</span></p>
    <div className="platform-preview-feed">
      {variant.posts.map((text, index) => variant.platform === "x" ? <article className="platform-preview-x-post" key={index} aria-label={`X post ${index + 1} of ${variant.posts.length}`}>
        <Avatar author={author} />
        <div className="platform-preview-x-content">
          <header className="platform-preview-x-author">
            <strong>{author.name || "Your profile"}</strong>
            {author.handle && <span className="platform-preview-handle">{author.handle.startsWith("@") ? author.handle : `@${author.handle}`}</span>}
            <span className="platform-preview-date">· Draft</span>
            <MoreHorizontal className="platform-preview-menu" size={20} aria-hidden="true" />
          </header>
          <FeedText text={text} platform="x" {...claimProps} />
          <XActions />
        </div>
      </article> : <article className="platform-preview-linkedin-post" key={index} aria-label={`LinkedIn post ${index + 1} of ${variant.posts.length}`}>
        <header className="platform-preview-linkedin-author">
          <Avatar author={author} />
          <div className="platform-preview-linkedin-identity">
            <strong>{author.name || "Your profile"}</strong>
            {author.headline && <span className="platform-preview-headline">{author.headline}</span>}
            <span className="platform-preview-date">Draft <span aria-hidden="true">·</span> <Globe2 size={12} aria-label="Public post" /></span>
          </div>
          <MoreHorizontal className="platform-preview-menu" size={24} aria-hidden="true" />
        </header>
        <FeedText text={text} platform="linkedin" {...claimProps} />
        <LinkedInActions />
      </article>)}
    </div>
  </section>;
}
