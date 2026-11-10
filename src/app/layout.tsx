import type { Metadata } from "next";
import Link from "next/link";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
export const metadata: Metadata = {
  title: "fireCalc | FIRE 시뮬레이터",
  description: "원화 기반 미국 ETF FIRE 시뮬레이터",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full bg-background text-foreground">
        <TooltipProvider>
          <header className="border-b">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
              <Link href="/" className="text-xl font-bold tracking-tight">
                fire<span className="text-primary">Calc</span>
              </Link>
              <nav className="flex gap-5 text-sm text-muted-foreground">
                <Link href="/simulate" className="hover:text-foreground">
                  시뮬레이터
                </Link>
                <Link href="/etfs" className="hover:text-foreground">
                  ETF 비교
                </Link>
              </nav>
            </div>
          </header>
          {children}
          <footer className="mt-16 border-t">
            <div className="mx-auto max-w-6xl px-4 py-8 text-xs leading-6 text-muted-foreground sm:px-6">
              본 서비스는 교육·정보 제공 목적이며 투자 권유가 아닙니다. 과거
              수익률은 미래 수익을 보장하지 않으며, 세금·환율·수수료를 단순화한
              계산입니다.
            </div>
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
