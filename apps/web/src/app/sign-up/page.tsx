
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name, email, password }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to create account.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Cannot connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0c0a10] px-5 py-12 text-white">
      <div className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-violet-600/10 blur-[100px]" />

      <section className="relative w-full max-w-[500px]">
        <div className="mb-7 flex items-center gap-3 font-mono text-xs tracking-[0.2em] text-zinc-400">
          <span className="h-2 w-2 rounded-full bg-orange-400" />
          START FREE
        </div>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Create your account
        </h1>

        <p className="mt-5 text-lg leading-7 text-zinc-400">
          Understand your codebase with AI.
          <br />
          Start with your public repositories.
        </p>

        <form onSubmit={handleSubmit} className="mt-9 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-zinc-200">Name</Label>
            <Input
              id="name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 border-white/10 bg-white/[0.03] text-white focus-visible:ring-violet-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-zinc-200">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 border-white/10 bg-white/[0.03] text-white focus-visible:ring-violet-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-zinc-200">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 border-white/10 bg-white/[0.03] text-white focus-visible:ring-violet-400"
            />
            <p className="text-xs text-zinc-500">At least 8 characters.</p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-13 w-full bg-zinc-100 text-base font-semibold text-zinc-950 hover:bg-white"
          >
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="mt-7 text-sm text-zinc-400">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-semibold text-white underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}

export default SignUp;