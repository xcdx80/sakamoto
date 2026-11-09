"use client";

import Link from "next/link";
import { RefreshCw, X } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { BookmarkDelivery } from "./BookmarkDelivery";
import { Processing } from "./Processing";

export function XSyncStatus({ owner, version }: { owner: string; version: number }) {
  return (
    <div className="library-sync-status">
      <Popover
        label="X sync status"
        width={440}
        triggerClass="library-sync-trigger"
        trigger={<><RefreshCw size={15} aria-hidden /> X sync status</>}
      >
        {(close) => <>
          <header className="flex items-center justify-between gap-3">
            <h2 className="sync-title">X sync status</h2>
            <button type="button" onClick={close} aria-label="Close X sync status" className="grid size-9 place-items-center rounded-full hover:bg-sunk">
              <X size={17} aria-hidden />
            </button>
          </header>
          <Link href="/library/import" className="sk-btn sk-btn-ink mt-4 w-full">Import bookmarks · X or Birdclaw →</Link>
          <BookmarkDelivery owner={owner} version={version} />
          <Processing owner={owner} version={version} />
        </>}
      </Popover>
    </div>
  );
}
