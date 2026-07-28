"use client";

import type { ReactNode } from "react";

type MarkdownContentProps = {
  content: string;
};

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-accent">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-background-card px-1.5 py-0.5 text-sm text-accent"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          className="text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:text-accent-light"
          target="_blank"
          rel="noreferrer"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return part;
  });
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const blocks = content.trim().split(/\n{2,}/);

  return (
    <div className="space-y-4 text-sm leading-7 text-foreground md:text-base md:leading-8">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const firstLine = lines[0];

        if (firstLine.startsWith("# ")) {
          return (
            <h1 key={index} className="mt-6 text-2xl font-bold text-foreground">
              {renderInline(firstLine.slice(2))}
            </h1>
          );
        }

        if (firstLine.startsWith("## ")) {
          return (
            <h2 key={index} className="mt-6 text-xl font-bold text-foreground">
              {renderInline(firstLine.slice(3))}
            </h2>
          );
        }

        if (firstLine.startsWith("### ")) {
          return (
            <h3 key={index} className="mt-5 text-lg font-bold text-foreground">
              {renderInline(firstLine.slice(4))}
            </h3>
          );
        }

        if (lines.every((line) => /^[-*]\s+/.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-2 pl-5 text-foreground">
              {lines.map((line) => (
                <li key={line}>{renderInline(line.replace(/^[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }

        if (lines.every((line) => /^\d+\.\s+/.test(line))) {
          return (
            <ol
              key={index}
              className="list-decimal space-y-2 pl-5 text-foreground"
            >
              {lines.map((line) => (
                <li key={line}>{renderInline(line.replace(/^\d+\.\s+/, ""))}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={index} className="whitespace-pre-line text-foreground">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}
