import Link from "next/link";
import type { ComponentProps } from "react";

export type WritingNavigationState = { dirty: boolean; busy: boolean };
export function WritingLink({ writingState, onClick, ...props }: ComponentProps<typeof Link> & { writingState?: WritingNavigationState }) {
  return <Link {...props} aria-disabled={writingState?.busy || undefined} onClick={event => {
    const leavesHere = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && props.target !== "_blank";
    if (leavesHere && (writingState?.busy || (writingState?.dirty && !window.confirm("Leave this draft without saving your edits?")))) {
      event.preventDefault(); return;
    }
    onClick?.(event);
  }} />;
}
