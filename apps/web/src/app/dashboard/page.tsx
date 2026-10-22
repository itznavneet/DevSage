
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRepositories, addRepository } from "@/lib/repository.api";
import type { Repository } from "@/lib/repository.api";
import { logoutUser } from "@/lib/auth.api";

export default function DashboardPage() {
  const router = useRouter();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const loadRepositories = useCallback(async () => {
    try {
      const data = await getRepositories();
      setRepositories(data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setError("Could not load repositories.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setAdding(true);

    try {
      const repository = await addRepository(url.trim());
      setRepositories((current) => [
        repository,
        ...current.filter((item) => item.id !== repository.id),
      ]);
      setUrl("");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setError(
          error.response?.data?.message || "Could not add repository."
        );
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleLogout() {
    try {
      await logoutUser();
    } finally {
      router.replace("/sign-in");
    }
  }

  return (
    <main className="min-h-screen bg-[#0c0a10] px-5 py-8 text-white sm:px-10">
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-zinc-400">
            DEV SAGE
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Your repositories
          </h1>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Sign out
        </Button>
      </header>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
          <h2 className="text-lg font-medium">Add a GitHub repository</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Start with a public repository to explore its code with AI.
          </p>

          <form
            onSubmit={handleAdd}
            className="mt-5 flex flex-col gap-3 sm:flex-row"
          >
            <Input
              type="url"
              required
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-12 border-white/10 bg-white/[0.03] text-white"
            />
            <Button
              type="submit"
              disabled={adding}
              className="h-12 shrink-0 bg-zinc-100 text-zinc-950 hover:bg-white"
            >
              {adding ? "Adding..." : "Add repository"}
            </Button>
          </form>

          {error && (
            <p role="alert" className="mt-4 text-sm text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="mt-9">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">Connected repositories</h2>
            <span className="text-sm text-zinc-500">
              {repositories.length} total
            </span>
          </div>

          {loading ? (
            <p className="py-8 text-sm text-zinc-400">
              Loading repositories...
            </p>
          ) : repositories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 p-8 text-center">
              <p className="font-medium">No repositories yet</p>
              <p className="mt-2 text-sm text-zinc-400">
                Add a public GitHub repository to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {repositories.map((repository) => (
                <article
                  key={repository.id}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <h3 className="font-medium">{repository.name}</h3>
                    <a
                      href={repository.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-sm text-zinc-400 underline underline-offset-4"
                    >
                      {repository.url}
                    </a>
                  </div>
                  <span className="w-fit rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300">
                    {repository.status}
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
