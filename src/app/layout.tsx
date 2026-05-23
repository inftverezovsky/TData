import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import DynamicTechBackground from "@/components/ui/DynamicTechBackground";
import { ClientErrorBoundary } from "@/components/ui/ClientErrorBoundary";

export const metadata: Metadata = {
  title: "TCyber",
  description: "Manual TCyber tournament loader",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="text-slate-900 selection:bg-indigo-100">
        <div className="flex min-h-screen flex-col relative z-0">
          {/* Dynamic dynamic circuit grid background */}
          <ClientErrorBoundary
            title="Фоновая анимация отключена"
            className="hidden"
          >
            <DynamicTechBackground />
          </ClientErrorBoundary>

          <header className="sticky top-0 z-50 border-b border-white/30 bg-white/60 backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
              <Link href="/" className="flex shrink-0 items-center gap-2 group">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white shadow-sm transition-colors group-hover:bg-indigo-700">
                  T
                </div>
                <span className="text-xl font-bold tracking-tight text-slate-900 group-hover:text-indigo-600 transition-colors">
                  TCyber
                </span>
              </Link>
              
              <Navbar />

              <div className="hidden shrink-0 items-center gap-3 sm:flex">
                <div className="h-2 w-2 rounded-full bg-indigo-50 shadow-[0_0_8px_rgba(79,70,229,0.5)]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Стабильно</span>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8 animate-in">
            {children}
          </main>
          
          <footer className="border-t border-slate-200/20 bg-transparent py-8 text-center text-sm font-medium text-slate-500">
            &copy; {new Date().getFullYear()} TCyber Admin Hub. Все права защищены.
          </footer>
        </div>
      </body>
    </html>
  );
}
