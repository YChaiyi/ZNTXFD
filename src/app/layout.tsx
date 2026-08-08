import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { GoatCounterRouteTracker } from "@/components/GoatCounterRouteTracker";
import { JoinCommunity } from "@/components/JoinCommunity";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "智能体先锋队可信知识库",
  description: "智能体先锋队社群 AI 实战内容、可信知识和来源证据平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="bg-background text-foreground">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.goatcounter={path:function(p){return location.host+(p||location.pathname+location.search)}};",
          }}
        />
        <script
          data-goatcounter="https://www.znt.group/stats/count"
          async
          src="https://www.znt.group/stats/count.js"
        />
      </head>
      <body className="bg-background text-foreground antialiased">
        <TopBar />
        <main className="mx-auto min-h-screen max-w-[1400px] px-4 pb-10 pt-6 md:px-8">
          {children}
        </main>
        <JoinCommunity />
        <footer className="border-t border-white/[0.06] bg-background-card/40 pb-24 pt-8 md:pb-10">
          <div className="mx-auto max-w-[1400px] space-y-4 px-4 md:px-8">
            <nav aria-label="更多站点" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
              <a
                href="https://bbs.znt.group/"
                target="_blank"
                rel="noreferrer"
                className="touch-target inline-flex min-h-11 items-center text-foreground-muted hover:text-accent"
              >
                先锋智能体论坛 ↗
              </a>
              <Link href="/token-rank" className="touch-target inline-flex min-h-11 items-center text-foreground-muted hover:text-accent">
                Token榜
              </Link>
            </nav>
            <p className="text-sm leading-6 text-foreground-muted">
              本站内容由 AI 自动整理自「智能体先锋队」社群讨论，由旺总维护。内容仅供参考，不保证准确性、完整性及时效性，不构成任何专业建议。原始发言版权归发言者所有，如需更正或有其他问题，请通过「加入智能体先锋队社群」区块的微信联系。
            </p>
            <p className="text-xs leading-5 text-foreground-muted">
              免责声明：本站所展示的信息均为 AI 自动汇编，未经人工逐条审核。使用者应自行判断内容的适用性，因使用本站信息所产生的任何后果，本站及维护者不承担任何责任。如内容涉及侵权，请联系我们及时删除。
            </p>
          </div>
        </footer>
        <BottomNav />
        <GoatCounterRouteTracker />
      </body>
    </html>
  );
}
