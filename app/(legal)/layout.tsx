import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./legal.module.css";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/">InView</Link>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
