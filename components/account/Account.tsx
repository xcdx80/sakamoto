"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";

/** Signed out: a small ink "Sign in". Signed in: the avatar, with Clerk's account menu. */
export function Account() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="sk-btn sk-btn-ink ml-1 !min-h-[32px] !px-3.5 !text-[13px]" data-tip="Keep your highlights and notes on every device">
            Sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <span className="grid size-9 place-items-center">
          <UserButton appearance={{ elements: { avatarBox: "size-7" } }} />
        </span>
      </Show>
    </>
  );
}
