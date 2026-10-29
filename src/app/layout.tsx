import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Vouch — AI escrow for freelance work",
  description: "Milestone escrow on PayPal, where AI drafts the contract, verifies delivery and settles disputes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-sm text-white">V</span>
              Vouch
            </Link>
            <nav className="flex gap-4 text-sm text-ink-soft">
              <Link href="/" className="hover:text-ink">Contracts</Link>
              <Link href="/new" className="hover:text-ink">New contract</Link>
              <Link href="/ledger" className="hover:text-ink">Ledger</Link>
            </nav>
            <span className="ml-auto rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn">
              PayPal Sandbox
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-ink-soft">
          Vouch is a hackathon prototype. All payments run in the PayPal sandbox; no real money moves.
        </footer>
      </body>
    </html>
  );
}
