import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PR Review AI",
  description: "Senior engineer code review in seconds, powered by GPT-4o",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-950 text-gray-100 min-h-screen`}>
        <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <span className="font-bold text-white tracking-tight">
            <span className="text-blue-400">PR</span> Review AI
          </span>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer"
             className="text-gray-400 hover:text-white text-sm transition-colors">
            GitHub ↗
          </a>
        </nav>
        {children}
      </body>
    </html>
  );
}
