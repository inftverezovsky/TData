import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import Navbar, { PlatformTabs } from "@/components/layout/Navbar";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";

export const metadata: Metadata = {
  title: "TData",
  description: "TData platform hub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="text-slate-900 selection:bg-indigo-100">
        <div className="flex min-h-screen flex-col relative z-0">
          <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-sm">
            <div className="mx-auto max-w-7xl px-4 md:px-6">
              <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                <Link href="/" className="flex shrink-0 items-center gap-2 group">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white shadow-sm transition-colors group-hover:bg-indigo-700">
                    T
                  </div>
                  <span className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-indigo-600 transition-colors">
                    TData
                  </span>
                </Link>

                <div className="flex min-w-0 flex-1 items-center justify-between gap-4 md:justify-end">
                  <PlatformTabs />

                  <div className="hidden shrink-0 items-center gap-3 sm:flex">
                    <div className="h-2 w-2 rounded-full bg-indigo-50 shadow-[0_0_8px_rgba(79,70,229,0.5)]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Стабильно</span>
                  </div>
                </div>
              </div>

              <Navbar />
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1620px] flex-1 px-4 py-6 md:px-6 md:py-8 animate-in">
            <AdminSessionProvider>{children}</AdminSessionProvider>
          </main>
          
          <footer className="border-t border-slate-200/20 bg-transparent py-8 text-center text-sm font-medium text-slate-500">
            &copy; {new Date().getFullYear()} TData Admin Hub. Все права защищены.
          </footer>
        </div>
      </body>
    </html>
  );
}
