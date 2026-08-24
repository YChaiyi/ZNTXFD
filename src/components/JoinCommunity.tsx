const VALUE_POINTS = [
  {
    title: "每日精华",
    description: "5 个实战社群的讨论每天沉淀成期刊，不用爬楼也能跟上。",
  },
  {
    title: "可信证据链",
    description: "观点带来源、证据和引用，可以回溯到原始讨论再判断。",
  },
  {
    title: "700+ 位实战者",
    description: "和一线实践者直接交流 AI 落地的真实经验与坑。",
  },
];

export function JoinCommunity() {
  return (
    <section
      id="join"
      className="scroll-mt-24 border-t border-white/[0.06] bg-[linear-gradient(100deg,rgba(255,143,42,0.08),rgba(255,143,42,0.01))]"
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-6 px-4 py-8 md:px-8">
        <div className="min-w-[240px] flex-1 space-y-2">
          <h2 className="text-lg font-black text-foreground">加入智能体先锋队社群</h2>
          <p className="text-sm leading-6 text-foreground-muted">
            这些讨论来自「智能体先锋队」社群。加微信
            <span className="mx-1 rounded-md bg-accent/10 px-2 py-0.5 font-mono font-semibold text-accent">
              wangzongplus
            </span>
            并备注「知识库」即可进群。
          </p>
        </div>
        <div className="grid flex-[2] gap-3 sm:grid-cols-3">
          {VALUE_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-[14px] border border-white/[0.07] bg-[#16161b] p-4"
            >
              <h3 className="text-sm font-black text-accent">{point.title}</h3>
              <p className="mt-2 text-xs leading-5 text-foreground-muted">
                {point.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
