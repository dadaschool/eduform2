import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "에듀폼 | EduForm",
  description: "중학교 평가·학생부·디지털배지 통합 플랫폼",
};

/**
 * 글꼴은 globals.css 의 --font-sans 로 정한다.
 *
 * next/font/google 을 쓰면 빌드할 때 구글에서 글꼴 파일을 받아온다.
 * 교내 서버는 서버 IP 나 키가 바뀔 때마다 다시 빌드해야 하는데
 * (NEXT_PUBLIC_ 값이 빌드 시점에 박히기 때문이다), 그때 바깥 인터넷이
 * 막혀 있으면 빌드가 실패한다. 기기에 있는 글꼴만 쓰도록 바꿨다.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
