import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LanguageProvider } from "@/components/language-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Scholar Workspace",
  description: "Local academic research workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
