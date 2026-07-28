import Link from "next/link";
import { TagBadge } from "@/components/TagBadge";
import { getQuestionItems } from "@/lib/data";
import type { QuestionItem } from "@/lib/data";

export const dynamic = "force-dynamic";

const statusText: Record<QuestionItem["status"], string> = {
  ai_answered: "AI 已答",
  expert_needed: "待专家",
  answered: "已采纳",
};

const statusTone: Record<QuestionItem["status"], string> = {
  ai_answered: "text-accent",
  expert_needed: "text-purple",
  answered: "text-success",
};

function QuestionCard({ question }: { question: QuestionItem }) {
  const primaryKnowledge = question.relatedKnowledge[0];

  return (
    <article className="glass-card card-hover p-5 hover:border-white/[0.14]">
      <div className="grid gap-5 lg:grid-cols-[96px_minmax(0,1fr)_280px]">
        <div className="grid grid-cols-2 gap-2 lg:block lg:space-y-3">
          <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-3 text-center">
            <p className="mono-num text-2xl font-bold text-accent">{question.votes}%</p>
            <p className="mt-1 text-xs text-foreground-muted">讨论热度</p>
          </div>
          <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-3 text-center">
            <p className="mono-num text-2xl font-bold text-success">{question.answers}</p>
            <p className="mt-1 text-xs text-foreground-muted">回答</p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={statusTone[question.status]}>{statusText[question.status]}</span>
            <span className="text-foreground-disabled">·</span>
            <span className="text-foreground-muted">{question.askedBy}</span>
          </div>
          <h2 className="mt-2 text-xl font-bold leading-8 text-foreground md:text-2xl">
            {question.title}
          </h2>
          <p className="mt-3 text-sm leading-7 text-foreground-muted">
            {question.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {question.tags.map((tag) => (
              <TagBadge key={tag}>{tag}</TagBadge>
            ))}
          </div>
          <div className="mt-5 rounded-[14px] border border-accent/10 bg-accent/[0.05] p-4">
            <p className="text-xs font-bold tracking-[0.18em] text-accent">
              AI 引用答案
            </p>
            <p className="mt-3 text-sm leading-7 text-foreground-muted">
              {question.answer}
            </p>
          </div>
        </div>

        <aside className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-4">
          <p className="text-xs font-bold tracking-[0.18em] text-accent">
            引用知识
          </p>
          <Link
            href={`/knowledge/${primaryKnowledge.slug}`}
            className="mt-3 block text-sm font-bold leading-6 text-foreground hover:text-accent"
          >
            {primaryKnowledge.title}
          </Link>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-foreground-muted">
            <span>评级 <b className="mono-num text-accent">{primaryKnowledge.rating ?? "A"}</b></span>
            <span>证据 <b className="mono-num text-foreground">{primaryKnowledge.evidenceCount}</b></span>
            <span>来源 <b className="mono-num text-success">{primaryKnowledge.sourceCount ?? primaryKnowledge.evidenceCount}</b></span>
            <span>引用 <b className="mono-num text-foreground">{primaryKnowledge.citationCount}</b></span>
          </div>
          <div className="mt-4 space-y-2">
            {question.relatedKnowledge.slice(1).map((item) => (
              <Link
                key={item.slug}
                href={`/knowledge/${item.slug}`}
                className="block rounded-[10px] border border-white/[0.04] bg-background/30 px-3 py-2 text-xs leading-5 text-foreground-muted hover:border-white/[0.14] hover:text-accent"
              >
                {item.title}
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </article>
  );
}

export default function QuestionsPage() {
  const questions = getQuestionItems();

  return (
    <section className="relative mx-auto w-full max-w-7xl overflow-hidden">
      <div className="pointer-events-none absolute -left-24 top-4 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.16)_0%,rgba(240,185,11,0)_68%)] blur-2xl" />
      <div className="pointer-events-none absolute right-0 top-44 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(131,100,255,0.13)_0%,rgba(131,100,255,0)_70%)] blur-2xl" />

      <header className="relative mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="glass-card glow-border p-6 md:p-8">
          <p className="text-xs font-bold tracking-[0.24em] text-accent">
            QUESTIONS WITH SOURCES
          </p>
          <h1 className="mt-4 max-w-4xl text-3xl font-bold leading-tight text-foreground md:text-5xl">
            提问引用
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-foreground-muted">
            普通群友可以提问，AI 先从可信知识库里找证据回答；需要判断、争议或验证时，再交给高等级专家补充。
          </p>
        </div>
        <aside className="glass-card p-5">
          <h2 className="text-lg font-bold text-foreground">MVP 流程</h2>
          <div className="mt-5 space-y-3 text-sm leading-6 text-foreground-muted">
            <p>1. 用户提问，AI 检索知识条目。</p>
            <p>2. 回答必须引用来源、评级和原始证据。</p>
            <p>3. 专家补充后再提升条目状态。</p>
            <p>4. 高价值问答反向沉淀为新知识。</p>
          </div>
        </aside>
      </header>

      <div className="relative mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">问答样例</h2>
        </div>
        <Link href="/knowledge" className="text-sm font-semibold text-accent">
          查看可信知识库 →
        </Link>
      </div>

      <div className="relative space-y-4">
        {questions.map((question) => (
          <QuestionCard key={question.slug} question={question} />
        ))}
      </div>
    </section>
  );
}
