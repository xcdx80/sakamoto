import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { loadAdminDashboard } from "@/lib/admin-dashboard";
import { AdminDashboardView } from "@/components/admin/AdminDashboardView";
import "./admin.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Library dashboard", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const dashboard = await loadAdminDashboard(auth);
  return <main className="admin-dashboard relative z-[1]">
    <nav aria-label="Dashboard navigation"><a href="/library">← Back to library</a><a href="/admin">Refresh</a></nav>
    <header><p className="admin-eyebrow">Private · Your account</p><h1>Library dashboard</h1>
      <p>Saved sources, categorization and processing for your library.</p></header>
    {dashboard.state === "signed-out" ? <section className="admin-panel">
      <h2>Sign in to view your dashboard</h2><p>Your library statistics are private to your account.</p>
      <SignInButton mode="modal"><button className="sk-btn sk-btn-ink admin-sign-in">Sign in</button></SignInButton>
    </section> : dashboard.state === "unavailable" ? <section className="admin-panel" role="status">
      <h2>Statistics unavailable</h2><p>We couldn’t read your library statistics. Try refreshing in a moment.</p>
    </section> : <AdminDashboardView owner={dashboard.owner} stats={dashboard.stats} />}
  </main>;
}
