"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { safeNextPath } from "@/lib/safeNextPath";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = (await response.json()) as {
        success: boolean;
        message?: string;
      };

      if (!response.ok || !data.success) {
        setError(data.message ?? "密码错误");
        return;
      }

      router.push(safeNextPath(new URLSearchParams(window.location.search).get("next")));
      router.refresh();
    } catch {
      setError("验证失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-10">
      <div className="pointer-events-none absolute -left-24 top-10 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(240,185,11,0.2)_0%,rgba(240,185,11,0)_70%)] blur-2xl" />
      <div className="pointer-events-none absolute bottom-10 right-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(2,192,118,0.14)_0%,rgba(2,192,118,0)_72%)] blur-2xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-accent">
            智能体先锋队知识库
          </h1>
          <p className="mt-3 text-base text-foreground-muted">
            社群知识沉淀平台
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) {
                  setError("");
                }
              }}
              placeholder="请输入访问密码"
              className="glass h-12 w-full rounded-2xl px-4 text-base text-foreground outline-none transition-colors placeholder:text-foreground-disabled focus:border-accent/70"
              autoComplete="current-password"
            />
            {error ? (
              <p className="mt-2 text-sm text-danger">{error}</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="glass h-12 w-full rounded-2xl bg-gradient-to-r from-accent via-accent-light to-[#d08b00] bg-[length:200%_200%] text-base font-semibold text-background shadow-[0_18px_50px_rgba(240,185,11,0.18)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "验证中" : "确认"}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-foreground-disabled">
          访问密码由管理员统一维护
        </p>
      </div>
    </div>
  );
}
