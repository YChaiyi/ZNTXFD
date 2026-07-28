"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  {
    label: "首页",
    href: "/",
    icon: (
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
        <path d="M4 19V8.5L12 3l8 5.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
        <path d="M9 21v-6h6v6" />
      </svg>
    ),
  },
  {
    label: "期刊",
    href: "/daily",
    icon: (
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
      </svg>
    ),
  },
  {
    label: "知识",
    href: "/knowledge",
    icon: (
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
    ),
  },
  {
    label: "先锋智能体论坛",
    displayLabel: "论坛",
    href: "https://bbs.znt.group/",
    external: true,
    icon: (
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
        <path d="M17 10a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v7l3-2h7a4 4 0 0 0 4-4Z" />
        <path d="M15 14h2l4 3V9a4 4 0 0 0-4-4h-1" />
      </svg>
    ),
  },
  {
    label: "Token",
    href: "/token-rank",
    icon: (
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
        <path d="M4 7h16" />
        <path d="M4 12h10" />
        <path d="M4 17h7" />
        <path d="M18 11v8" />
        <path d="m15 16 3 3 3-3" />
      </svg>
    ),
  },
  {
    label: "提问",
    href: "/questions",
    icon: (
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
    ),
  },
  {
    label: "搜索",
    href: "/search",
    icon: (
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
        <path d="m21 21-4.35-4.35" />
        <circle cx="11" cy="11" r="7" />
      </svg>
    ),
  },
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

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 grid h-[72px] grid-cols-7 border-t border-white/[0.07] bg-background/90 px-1 backdrop-blur-[20px] md:hidden">
      {tabs.map((tab) => {
        const active = isActivePath(pathname, tab.href);
        const className = `flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors ${
          active
            ? "bg-accent/15 text-accent"
            : "text-foreground-muted hover:text-foreground"
        }`;
        const label = <span className="max-w-full truncate">{tab.displayLabel ?? tab.label}</span>;

        if (tab.external) {
          return (
            <a
              key={tab.href}
              href={tab.href}
              target="_blank"
              rel="noreferrer"
              aria-label={tab.label}
              title={tab.label}
              className={className}
            >
              {tab.icon}
              {label}
            </a>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-label={tab.label}
            title={tab.label}
            className={className}
          >
            {tab.icon}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
