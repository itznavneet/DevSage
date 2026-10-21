
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCurrentUser, logoutUser } from "@/lib/auth.api";
import type { AuthUser } from "@/lib/auth.api";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => router.replace("/sign-in"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    try {
      await logoutUser();
    } finally {
      router.replace("/sign-in");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0c0a10] p-10 text-white">
        Loading your workspace...
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[#0c0a10] p-10 text-white">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">DevSage</h1>
        <Button variant="outline" onClick={handleLogout}>
          Sign out
        </Button>
      </header>

      <section className="mt-12">
        <h2 className="text-2xl font-medium">
          Welcome, {user.name || user.email}
        </h2>
        <p className="mt-2 text-zinc-400">
          Your AI codebase workspace is ready to build.
        </p>
      </section>
    </main>
  );
}
