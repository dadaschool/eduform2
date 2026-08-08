import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geist = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "에듀폼 | EduForm",
  description: "중학교 평가·학생부·디지털배지 통합 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${geist.className} min-h-screen bg-gray-50`}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
