"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addRepository,
  getRepositories,
  reindexRepository,
} from "@/lib/repository.api";
import type { Repository } from "@/lib/repository.api";
import { logoutUser } from "@/lib/auth.api";
import { askRepository, type AskRepositoryResponse } from "@/lib/ai.api";

const activeStatuses: Repository["status"][] = [
  "PENDING",
  "CLONING",
  "INDEXING",
];

function isIngesting(status: Repository["status"]) {
  return activeStatuses.includes(status);
}

function statusCopy(status: Repository["status"]) {
  switch (status) {
    case "PENDING":
      return "Queued for indexing";
    case "CLONING":
      return "Downloading repository";
    case "INDEXING":
      return "Reading code and building search index";
    case "READY":
      return "Ready for questions";
    case "FAILED":
      return "Indexing needs attention";
  }
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StatusBadge({ status }: { status: Repository["status"] }) {
  const ready = status === "READY";
  const failed = status === "FAILED";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        ready
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : failed
            ? "border-red-400/25 bg-red-400/10 text-red-300"
            : "border-amber-400/25 bg-amber-400/10 text-amber-200"
      }`}
    >
      {ready ? (
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
      ) : failed ? (
        <AlertCircle className="size-3.5" aria-hidden="true" />
      ) : (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      )}
      {status}
    </span>
  );
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

  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [answer, setAnswer] = useState<AskRepositoryResponse | null>(null);

  const loadRepositories = useCallback(
    async (showInitialLoader = false) => {
      if (showInitialLoader) setLoading(true);
      else setRefreshing(true);

      try {
        const data = await getRepositories();
        setRepositories(data);
        setError("");
      } catch (requestError) {
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          router.replace("/sign-in");
          return;
        }
        setError("Could not load repositories. Try refreshing the page.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    // Initial data loading is an external API subscription; the lint rule
    // otherwise treats the promise callback as a render-time state update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRepositories(true);
  }, [loadRepositories]);

  const hasIngestionJobs = repositories.some((repository) =>
    isIngesting(repository.status),
  );

  useEffect(() => {
    if (!hasIngestionJobs) return;

    const timer = window.setInterval(() => {
      void loadRepositories();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [hasIngestionJobs, loadRepositories]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAdding(true);

    try {
      const repository = await addRepository(url.trim());
      setRepositories((current) => [
        repository,
        ...current.filter((item) => item.id !== repository.id),
      ]);
      setUrl("");
    } catch (requestError) {
      if (axios.isAxiosError(requestError)) {
        setError(
          requestError.response?.data?.message ||
            requestError.response?.data?.error ||
            "Could not add repository.",
        );
      } else {
        setError("Something went wrong while adding the repository.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleReindex(repository: Repository) {
    setRetryingId(repository.id);
    setError("");

    try {
      await reindexRepository(repository.id);
      setRepositories((current) =>
        current.map((item) =>
          item.id === repository.id
            ? { ...item, status: "INDEXING", errorMessage: null }
            : item,
        ),
      );
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }

      setError(
        axios.isAxiosError(requestError)
          ? requestError.response?.data?.message || "Could not restart indexing."
          : "Could not restart indexing.",
      );
    } finally {
      setRetryingId(null);
    }
  }

  async function handleLogout() {
    try {
      await logoutUser();
    } finally {
      router.replace("/sign-in");
    }
  }

  function selectRepository(repository: Repository) {
    if (repository.status !== "READY") return;
    setSelectedRepositoryId(repository.id);
    setQuestion("");
    setAnswer(null);
    setAskError("");
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRepositoryId || !question.trim()) return;

    setAsking(true);
    setAskError("");
    setAnswer(null);

    try {
      setAnswer(await askRepository(selectedRepositoryId, question.trim()));
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setAskError(
        axios.isAxiosError(requestError)
          ? requestError.response?.data?.error ||
              requestError.response?.data?.message ||
              "Could not get an answer. Please try again."
          : "Something went wrong while asking DevSage.",
      );
    } finally {
      setAsking(false);
    }
  }

  const selectedRepository = repositories.find(
    (repository) => repository.id === selectedRepositoryId && repository.status === "READY",
  );

  return (
    <main className="min-h-screen bg-[#0c0a10] px-4 py-6 text-white sm:px-6 sm:py-8 lg:px-8">
      <header className="mx-auto flex max-w-6xl flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-[0.2em] text-zinc-500">DEV SAGE</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your repositories</h1>
          <p className="mt-2 text-sm text-zinc-400">Index a codebase, then ask questions grounded in its source.</p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleLogout}
          className="w-full border-red-400/25 bg-red-400/5 text-red-200 hover:border-red-400/50 hover:bg-red-400/15 hover:text-red-100 sm:w-auto"
        >
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </header>

      <section className="mx-auto mt-7 max-w-6xl space-y-8">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 sm:p-7">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-2 text-zinc-300">
              <GitBranch className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-medium">Add a GitHub repository</h2>
              <p className="mt-1 text-sm text-zinc-400">Public repositories are cloned and indexed in the background.</p>
            </div>
          </div>

          <form onSubmit={handleAdd} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Input
              type="url"
              required
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="h-11 border-white/10 bg-black/20 text-white placeholder:text-zinc-600"
            />
            <Button type="submit" disabled={adding} className="h-11 w-full bg-zinc-100 text-zinc-950 hover:bg-white sm:w-auto">
              {adding ? <LoaderCircle className="animate-spin" /> : null}
              {adding ? "Adding repository..." : "Add repository"}
            </Button>
          </form>

          {error ? (
            <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : null}
        </div>

        <section aria-labelledby="repositories-heading">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="repositories-heading" className="text-lg font-medium">Connected repositories</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadRepositories()}
              disabled={refreshing}
              className="w-full border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white sm:w-auto"
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3" aria-live="polite" aria-label="Loading repositories">
              {[1, 2].map((item) => (
                <div key={item} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
              ))}
            </div>
          ) : repositories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 p-8 text-center sm:p-12">
              <GitBranch className="mx-auto size-8 text-zinc-600" aria-hidden="true" />
              <p className="mt-4 font-medium">No repositories yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-400">Add a public GitHub repository above to start exploring it with DevSage.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {repositories.map((repository) => {
                const indexedAt = formatDate(repository.lastIndexedAt);
                const retrying = retryingId === repository.id;

                return (
                  <article key={repository.id} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/15 sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-medium">{repository.name}</h3>
                          <StatusBadge status={repository.status} />
                        </div>
                        <a href={repository.url} target="_blank" rel="noreferrer" className="mt-2 flex min-w-0 max-w-full items-center gap-1 text-sm text-zinc-400 underline decoration-white/20 underline-offset-4 hover:text-white">
                          <span className="truncate">{repository.url}</span>
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                        </a>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button type="button" disabled={repository.status !== "READY"} onClick={() => selectRepository(repository)} className="bg-white text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed">
                          <MessageSquareText aria-hidden="true" />
                          Ask DevSage
                        </Button>
                        {repository.status === "PENDING" || repository.status === "FAILED" || repository.status === "READY" ? (
                          <Button type="button" variant="outline" disabled={retrying} onClick={() => void handleReindex(repository)} className="border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white">
                            <RefreshCw className={retrying ? "animate-spin" : ""} aria-hidden="true" />
                            {retrying ? "Starting..." : repository.status === "PENDING" ? "Start indexing" : repository.status === "FAILED" ? "Retry indexing" : "Re-index"}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 border-t border-white/10 pt-4">
                      {isIngesting(repository.status) ? (
                        <div aria-live="polite">
                          <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                            <span>{statusCopy(repository.status)}</span>
                            <span>Updates automatically</span>
                          </div>
                          <div role="progressbar" aria-label={`${statusCopy(repository.status)} progress`} className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full w-2/5 animate-pulse rounded-full bg-amber-300" />
                          </div>
                        </div>
                      ) : repository.status === "FAILED" ? (
                        <div className="flex items-start gap-2 text-sm text-red-300">
                          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          <p>{repository.errorMessage || "Indexing failed. Retry to try again."}</p>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                          <span className="flex items-center gap-1.5 text-emerald-300"><CircleDot className="size-3.5" aria-hidden="true" />{statusCopy(repository.status)}</span>
                          {indexedAt ? <span>Last indexed {indexedAt}</span> : null}
                        </div>
                      )}
                    </div>

                    {repository.id === selectedRepositoryId ? <p className="mt-3 text-xs text-zinc-400">Selected for repository Q&amp;A.</p> : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selectedRepository ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 sm:p-7">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-orange-400/20 bg-orange-400/10 p-2 text-orange-300"><Sparkles className="size-5" aria-hidden="true" /></div>
              <div className="min-w-0">
                <p className="font-mono text-xs tracking-[0.18em] text-zinc-500">REPOSITORY INTELLIGENCE</p>
                <h2 className="mt-2 truncate text-xl font-semibold">Ask about {selectedRepository.name}</h2>
                <p className="mt-2 text-sm text-zinc-400">Ask about architecture, functions, files, dependencies, or how a feature works.</p>
              </div>
            </div>

            <form onSubmit={handleAsk} className="mt-6 space-y-3">
              <label htmlFor="repository-question" className="text-sm text-zinc-300">Your question</label>
              <textarea id="repository-question" required maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Where is the main application entry point?" className="min-h-28 w-full resize-y rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-white/30 focus:ring-2 focus:ring-white/10" />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-zinc-500">{question.length}/2000 characters</span>
                <Button type="submit" disabled={asking || !question.trim()} className="w-full bg-white px-5 text-zinc-950 hover:bg-zinc-200 sm:w-auto">
                  {asking ? <LoaderCircle className="animate-spin" /> : <Send aria-hidden="true" />}
                  {asking ? "Analyzing code..." : "Ask question"}
                </Button>
              </div>
            </form>

            {askError ? (
              <div role="alert" className="mt-6 flex flex-col gap-3 rounded-lg border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{askError}</span>
                <Button type="button" variant="outline" onClick={() => void handleAsk({ preventDefault() {} } as FormEvent<HTMLFormElement>)} className="border-red-400/25 bg-transparent text-red-200 hover:bg-red-400/10 hover:text-red-100">Try again</Button>
              </div>
            ) : null}

            {asking ? (
              <div className="mt-7 space-y-4" aria-live="polite" aria-label="Generating answer">
                <div className="flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Searching the repository and generating an answer...</div>
                <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-5"><div className="h-3 w-1/4 animate-pulse rounded bg-white/10" /><div className="h-3 w-full animate-pulse rounded bg-white/10" /><div className="h-3 w-4/5 animate-pulse rounded bg-white/10" /></div>
              </div>
            ) : answer ? (
              <div className="mt-7 space-y-6">
                <div className="rounded-lg border border-white/10 bg-black/20 p-5 sm:p-6"><h3 className="font-medium">Answer</h3><div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{answer.answer}</div></div>
                <div>
                  <div className="flex items-baseline justify-between gap-3"><h3 className="font-medium">Code references</h3><span className="text-xs text-zinc-500">{answer.sources.length} source{answer.sources.length === 1 ? "" : "s"}</span></div>
                  {answer.sources.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-white/15 p-5 text-sm text-zinc-500">No source chunks were returned for this answer.</div>
                  ) : (
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {answer.sources.map((source, index) => {
                        const sourceUrl = `https://github.com/${selectedRepository.githubOwner}/${selectedRepository.githubName}/blob/${selectedRepository.defaultBranch}/${source.file_path}#L${source.start_line}-L${source.end_line}`;
                        return <a key={`${source.file_path}-${source.start_line}-${index}`} href={sourceUrl} target="_blank" rel="noreferrer" className="group rounded-lg border border-white/10 bg-black/10 p-4 transition-colors hover:border-white/25 hover:bg-white/[0.04]"><div className="flex items-start justify-between gap-3"><code className="min-w-0 break-all text-sm font-medium text-zinc-200 group-hover:text-white">{source.file_path}</code><ExternalLink className="size-4 shrink-0 text-zinc-500 group-hover:text-zinc-200" aria-hidden="true" /></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500"><span>Lines {source.start_line}–{source.end_line}</span><span>Match {(source.score * 100).toFixed(1)}%</span></div></a>;
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-7 rounded-lg border border-dashed border-white/15 p-6 text-center sm:p-8"><MessageSquareText className="mx-auto size-7 text-zinc-600" aria-hidden="true" /><p className="mt-3 text-sm font-medium text-zinc-300">Your answer will appear here</p><p className="mt-1 text-sm text-zinc-500">Ask a question to search this repository and generate a grounded response.</p></div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
