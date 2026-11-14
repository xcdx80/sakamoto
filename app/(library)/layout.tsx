import type { ReactNode } from "react";
import { AccountLibrary } from "@/components/account/SyncAgent";

export default function LibraryLayout({ children }: { children: ReactNode }) {
  return <AccountLibrary>{children}</AccountLibrary>;
}
