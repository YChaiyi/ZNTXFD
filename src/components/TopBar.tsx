"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function BrainIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3a3 3 0 0 0-3 3v.4A3.8 3.8 0 0 0 4 10a3.8 3.8 0 0 0 2 3.4V18a3 3 0 0 0 5.2 2" />
      <path d="M15 3a3 3 0 0 1 3 3v.4a3.8 3.8 0 0 1 2 3.6 3.8 3.8 0 0 1-2 3.4V18a3 3 0 0 1-5.2 2" />
      <path d="M9 8h6" />
      <path d="M9 13h6" />
      <path d="M12 3v18" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V9l8-6 8 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function DailyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3v3" />
      <path d="M17 3v3" />
      <path d="M4 8h16" />
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 12h4" />
      <path d="M8 16h8" />
    </svg>
  );
}

function KnowledgeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v14H6.5A2.5 2.5 0 0 0 4 20.5Z" />
      <path d="M4 6.5v14" />
      <path d="M8 8h8" />
      <path d="M8 12h7" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      <path d="M9 8h6" />
      <path d="M9 12h4" />
    </svg>
  );
}

function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21 21-4.35-4.35" />
      <circle cx="11" cy="11" r="7" />
    </svg>
  );
}

const navItems = [
  { label: "首页", href: "/", icon: <HomeIcon /> },
  { label: "期刊", href: "/daily", icon: <DailyIcon /> },
  { label: "知识库", href: "/knowledge", icon: <KnowledgeIcon /> },
  { label: "提问", href: "/questions", icon: <QuestionIcon /> },
  { label: "搜索", href: "/search", icon: <SearchIcon /> },
];

function isActivePath(pathname: string, href: string) {
  if (!href.startsWith("/")) {
    return false;
  }

  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 min-h-16 border-b border-white/[0.07] bg-background/85 backdrop-blur-[20px]">
      <div className="mx-auto flex min-h-16 max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-2 md:px-8">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2">
          <span className="text-2xl font-black tracking-[-0.04em] text-foreground drop-shadow-[0_0_16px_rgba(255,138,30,0.36)]">
            智能体
          </span>
          <span className="inline-flex items-center gap-1 rounded-[9px] bg-gradient-to-b from-[#ffc06e] via-[#ff6f00] to-[#ff5200] px-3 py-1 text-2xl font-black tracking-[-0.02em] text-[#160800] shadow-[0_0_22px_rgba(255,106,0,0.55),0_6px_16px_rgba(255,106,0,0.32),inset_0_1.5px_0_rgba(255,255,255,0.55)]">
            先锋队
          </span>
          <span className="ml-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.035] text-accent sm:flex">
            <BrainIcon className="h-5 w-5" />
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            const className = `inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[15px] font-semibold transition-colors lg:px-3 xl:px-4 ${
              active
                ? "text-foreground shadow-[inset_0_-2px_0_#ff9f3a]"
                : "text-foreground-muted hover:bg-white/[0.04] hover:text-foreground"
            }`;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={className}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <Link
            href="/search"
            className="hidden h-11 w-56 items-center gap-2 rounded-full border border-white/[0.10] bg-[#191920] px-4 text-[15px] font-medium text-foreground-muted transition-colors hover:border-accent/40 hover:text-foreground lg:flex"
          >
            <SearchIcon className="h-5 w-5 shrink-0" />
            <span className="truncate">搜索工具、观点、案例…</span>
          </Link>
          <span className="hidden items-center gap-2 text-sm font-medium text-foreground-muted xl:inline-flex">
            <span className="pulse-dot" aria-hidden="true" />
            持续沉淀
          </span>
          <a
            href="#join"
            className="inline-flex h-10 shrink-0 items-center rounded-lg bg-gradient-to-b from-accent-light to-accent px-4 text-sm font-black text-background transition-transform hover:-translate-y-0.5"
          >
            加入社群
          </a>
        </div>
      </div>
    </header>
  );
}
