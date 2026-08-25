"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
    label: "知识库",
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
  const [moreOpen, setMoreOpen] = useState(false);

  const moreLinks = [
    { label: "搜索", href: "/search" },
    { label: "Token榜", href: "/token-rank" },
    { label: "先锋智能体论坛", href: "https://bbs.znt.group/", external: true },
  ];

  return (
    <>
      <nav
        id="bottom-more-panel"
        aria-label="更多入口"
        data-more-panel
        className={`fixed bottom-[72px] left-0 right-0 z-50 border-t border-white/[0.07] bg-background/95 px-4 py-2 backdrop-blur-[20px] md:hidden ${
          moreOpen ? "" : "hidden"
        }`}
      >
        {moreLinks.map((link) =>
          link.external ? (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMoreOpen(false)}
              className="touch-target flex min-h-11 items-center text-sm font-semibold text-foreground-muted hover:text-foreground"
            >
              {link.label} ↗
            </a>
          ) : (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMoreOpen(false)}
              className="touch-target flex min-h-11 items-center text-sm font-semibold text-foreground-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ),
        )}
      </nav>

      <nav className="fixed bottom-0 left-0 right-0 z-50 grid h-[72px] grid-cols-5 border-t border-white/[0.07] bg-background/90 px-1 backdrop-blur-[20px] md:hidden">
        {tabs.map((tab) => {
          const active = isActivePath(pathname, tab.href);
          const className = `flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors ${
            active
              ? "bg-accent/15 text-accent"
              : "text-foreground-muted hover:text-foreground"
          }`;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              title={tab.label}
              className={className}
            >
              {tab.icon}
              <span className="max-w-full truncate">{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="bottom-more-panel"
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors ${
            moreOpen ? "bg-accent/15 text-accent" : "text-foreground-muted hover:text-foreground"
          }`}
        >
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
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
          <span className="max-w-full truncate">更多</span>
        </button>
      </nav>
    </>
  );
}
