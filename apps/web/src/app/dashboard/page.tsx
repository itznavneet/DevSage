"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { AlertCircle, CheckCircle2, CircleDot, ExternalLink, GitBranch, LoaderCircle, LogOut, MessageSquareText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addRepository, getRepositories, reindexRepository, type Repository } from "@/lib/repository.api";
import { logoutUser } from "@/lib/auth.api";

const activeStatuses: Repository["status"][] = ["PENDING", "CLONING", "INDEXING"];

function isIngesting(status: Repository["status"]) {
  return activeStatuses.includes(status);
}

function statusCopy(status: Repository["status"]) {
  switch (status) {
    case "PENDING": return "Queued for indexing";
    case "CLONING": return "Downloading repository";
    case "INDEXING": return "Reading code and building search index";
    case "READY": return "Ready for questions";
    case "FAILED": return "Indexing needs attention";
  }
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function StatusBadge({ status }: { status: Repository["status"] }) {
  const ready = status === "READY";
  const failed = status === "FAILED";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${ready ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : failed ? "border-red-400/25 bg-red-400/10 text-red-300" : "border-amber-400/25 bg-amber-400/10 text-amber-200"}`}>{ready ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : failed ? <AlertCircle className="size-3.5" aria-hidden="true" /> : <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}{status}</span>;
}

export default function DashboardPage() {
  const router = useRouter();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadRepositories = useCallback(async (showInitialLoader = false) => {
    if (showInitialLoader) setLoading(true); else setRefreshing(true);
    try {
      setRepositories(await getRepositories());
      setError("");
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) { router.replace("/sign-in"); return; }
      setError("Could not load repositories. Try refreshing the page.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    // Initial data loading is an external API subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRepositories(true);
  }, [loadRepositories]);

  const hasIngestionJobs = repositories.some((repository) => isIngesting(repository.status));

  useEffect(() => {
    if (!hasIngestionJobs) return;
    const timer = window.setInterval(() => void loadRepositories(), 5000);
    return () => window.clearInterval(timer);
  }, [hasIngestionJobs, loadRepositories]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAdding(true);
    try {
      const repository = await addRepository(url.trim());
      setRepositories((current) => [repository, ...current.filter((item) => item.id !== repository.id)]);
      setUrl("");
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.message || requestError.response?.data?.error || "Could not add repository." : "Something went wrong while adding the repository.");
    } finally {
      setAdding(false);
    }
  }

  async function handleReindex(repository: Repository) {
    setRetryingId(repository.id);
    setError("");
    try {
      await reindexRepository(repository.id);
      setRepositories((current) => current.map((item) => item.id === repository.id ? { ...item, status: "INDEXING", errorMessage: null } : item));
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) { router.replace("/sign-in"); return; }
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.message || "Could not restart indexing." : "Could not restart indexing.");
    } finally {
      setRetryingId(null);
    }
  }

  async function handleLogout() {
    try { await logoutUser(); } finally { router.replace("/sign-in"); }
  }

  return (
    <main className="min-h-screen bg-[#0c0a10] px-4 py-6 text-white sm:px-6 sm:py-8 lg:px-8">
      <header className="mx-auto flex max-w-6xl flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="font-mono text-xs tracking-[0.2em] text-zinc-500">DEV SAGE</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your repositories</h1><p className="mt-2 text-sm text-zinc-400">Index a codebase, then ask questions grounded in its source.</p></div>
        <Button type="button" variant="outline" onClick={handleLogout} className="w-full border-red-400/25 bg-red-400/5 text-red-200 hover:border-red-400/50 hover:bg-red-400/15 hover:text-red-100 sm:w-auto"><LogOut aria-hidden="true" /> Sign out</Button>
      </header>

      <section className="mx-auto mt-7 max-w-6xl space-y-8">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 sm:p-7">
          <div className="flex items-start gap-3"><div className="rounded-lg border border-white/10 bg-white/[0.06] p-2 text-zinc-300"><GitBranch className="size-5" aria-hidden="true" /></div><div><h2 className="text-lg font-medium">Add a GitHub repository</h2><p className="mt-1 text-sm text-zinc-400">Public repositories are cloned and indexed in the background.</p></div></div>
          <form onSubmit={handleAdd} className="mt-5 flex flex-col gap-3 sm:flex-row"><Input type="url" required placeholder="https://github.com/owner/repository" value={url} onChange={(event) => setUrl(event.target.value)} className="h-11 border-white/10 bg-black/20 text-white placeholder:text-zinc-600" /><Button type="submit" disabled={adding} className="h-11 w-full bg-zinc-100 text-zinc-950 hover:bg-white sm:w-auto">{adding ? <LoaderCircle className="animate-spin" /> : null}{adding ? "Adding repository..." : "Add repository"}</Button></form>
          {error ? <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-300"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p> : null}
        </div>

        <section aria-labelledby="repositories-heading">
          <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 id="repositories-heading" className="text-lg font-medium">Connected repositories</h2><p className="mt-1 text-sm text-zinc-500">{repositories.length} {repositories.length === 1 ? "repository" : "repositories"}</p></div><Button type="button" variant="outline" onClick={() => void loadRepositories()} disabled={refreshing} aria-busy={refreshing} className="w-fit shrink-0 border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"><RefreshCw className={refreshing ? "animate-spin" : ""} aria-hidden="true" />{refreshing ? "Refreshing..." : "Refresh"}</Button></div>
          {loading ? <div className="space-y-3" aria-live="polite" aria-label="Loading repositories">{[1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />)}</div> : repositories.length === 0 ? <div className="rounded-xl border border-dashed border-white/15 p-8 text-center sm:p-12"><GitBranch className="mx-auto size-8 text-zinc-600" aria-hidden="true" /><p className="mt-4 font-medium">No repositories yet</p><p className="mx-auto mt-2 max-w-sm text-sm text-zinc-400">Add a public GitHub repository above to start exploring it with DevSage.</p></div> : <div className="space-y-3">
            {repositories.map((repository) => {
              const indexedAt = formatDate(repository.lastIndexedAt);
              const retrying = retryingId === repository.id;
              return <article key={repository.id} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/15 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-medium">{repository.name}</h3><StatusBadge status={repository.status} /></div><a href={repository.url} target="_blank" rel="noreferrer" className="mt-2 flex min-w-0 max-w-full items-center gap-1 text-sm text-zinc-400 underline decoration-white/20 underline-offset-4 hover:text-white"><span className="truncate">{repository.url}</span><ExternalLink className="size-3.5 shrink-0" aria-hidden="true" /></a></div><div className="flex flex-wrap gap-2 lg:justify-end"><Button type="button" disabled={repository.status !== "READY"} onClick={() => router.push(`/dashboard/repositories/${encodeURIComponent(repository.id)}/chat`)} className="bg-white text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed"><MessageSquareText aria-hidden="true" />Ask DevSage</Button>{repository.status === "PENDING" || repository.status === "FAILED" || repository.status === "READY" ? <Button type="button" variant="outline" disabled={retrying} onClick={() => void handleReindex(repository)} className="border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"><RefreshCw className={retrying ? "animate-spin" : ""} aria-hidden="true" />{retrying ? "Starting..." : repository.status === "PENDING" ? "Start indexing" : repository.status === "FAILED" ? "Retry indexing" : "Re-index"}</Button> : null}</div></div>
                <div className="mt-4 border-t border-white/10 pt-4">{isIngesting(repository.status) ? <div aria-live="polite"><div className="flex items-center justify-between gap-3 text-xs text-zinc-400"><span>{statusCopy(repository.status)}</span><span>Updates automatically</span></div><div role="progressbar" aria-label={`${statusCopy(repository.status)} progress`} className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-2/5 animate-pulse rounded-full bg-amber-300" /></div></div> : repository.status === "FAILED" ? <div className="flex items-start gap-2 text-sm text-red-300"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>{repository.errorMessage || "Indexing failed. Retry to try again."}</p></div> : <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500"><span className="flex items-center gap-1.5 text-emerald-300"><CircleDot className="size-3.5" aria-hidden="true" />{statusCopy(repository.status)}</span>{indexedAt ? <span>Last indexed {indexedAt}</span> : null}</div>}</div>
              </article>;
            })}
          </div>}
        </section>
      </section>
    </main>
  );
}
