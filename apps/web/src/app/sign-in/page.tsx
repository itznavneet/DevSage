
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import axios from "axios";
import { loginUser } from "@/lib/auth.api";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);


async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  setError("");
  setLoading(true);

  try {
    await loginUser({ email, password });
    router.push("/dashboard");
  } catch (error) {
    if (axios.isAxiosError(error)) {
      setError(
        error.response?.data?.message ||
          "Unable to sign in. Please try again."
      );
    } else {
      setError("Something went wrong. Please try again.");
    }
  } finally {
    setLoading(false);
  }
}


  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0c0a10] px-5 py-12 text-white">
      <section className="w-full max-w-[500px]">
        <p className="mb-7 font-mono text-xs tracking-[0.2em] text-zinc-400">
          <span className="mr-3 text-orange-400">●</span>WELCOME BACK
        </p>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Sign in
        </h1>
        <p className="mt-5 text-lg text-zinc-400">
          Continue exploring your codebase.
        </p>

        <form onSubmit={handleSubmit} className="mt-9 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 border-white/10 bg-white/[0.03] text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 border-white/10 bg-white/[0.03] text-white"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-13 w-full bg-zinc-100 text-base font-semibold text-zinc-950 hover:bg-white"
          >
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="mt-7 text-sm text-zinc-400">
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="font-semibold text-white underline underline-offset-4">
            Create account
          </Link>
        </p>
      </section>
    </main>
  );
}
