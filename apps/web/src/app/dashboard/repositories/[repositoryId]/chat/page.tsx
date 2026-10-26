"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import AuthGuard from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRepositories, type Repository } from "@/lib/repository.api";
import { askRepository, type AskRepositoryResponse } from "@/lib/ai.api";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getConversations,
  updateConversation,
  type Conversation,
  type ConversationMessage,
  type ConversationWithMessages,
} from "@/lib/conversation.api";

type CodeSource = AskRepositoryResponse["sources"][number];

function isCodeSource(value: unknown): value is CodeSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.file_path === "string" &&
    typeof source.start_line === "number" &&
    typeof source.end_line === "number"
  );
}

function getSources(message: ConversationMessage) {
  return Array.isArray(message.sources)
    ? message.sources.filter(isCodeSource)
    : [];
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function errorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error || error.response?.data?.message || fallback;
  }
  return fallback;
}

function ChatWorkspace({ repositoryId }: { repositoryId: string }) {
  const router = useRouter();
  const [repository, setRepository] = useState<Repository | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<ConversationWithMessages | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");

  const loadConversation = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setError("");
    try {
      setConversation(await getConversation(conversationId));
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setError(errorMessage(requestError, "Could not load this conversation."));
    } finally {
      setLoadingMessages(false);
    }
  }, [router]);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [repositories, savedConversations] = await Promise.all([
        getRepositories(),
        getConversations(repositoryId),
      ]);
      const ownedRepository = repositories.find((item) => item.id === repositoryId);

      if (!ownedRepository) {
        router.replace("/dashboard");
        return;
      }

      setRepository(ownedRepository);
      setConversations(savedConversations);
      if (savedConversations[0]) {
        await loadConversation(savedConversations[0].id);
      }
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setError(errorMessage(requestError, "Could not load the chat workspace."));
    } finally {
      setLoading(false);
    }
  }, [loadConversation, repositoryId, router]);

  useEffect(() => {
    // Initial data loading is an external API subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedId = conversation?.id;
  const canAsk = Boolean(repository?.status === "READY" && conversation && question.trim());

  async function handleNewChat() {
    setCreating(true);
    setError("");
    try {
      const created = await createConversation(repositoryId);
      setConversations((current) => [created, ...current]);
      await loadConversation(created.id);
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setError(errorMessage(requestError, "Could not start a new conversation."));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!conversation || !window.confirm("Delete this conversation?")) return;

    setDeleting(true);
    setError("");
    try {
      await deleteConversation(conversation.id);
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      setConversation(null);
      if (remaining[0]) await loadConversation(remaining[0].id);
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not delete this conversation."));
    } finally {
      setDeleting(false);
    }
  }

  function startRename() {
    if (!conversation) return;
    setTitleDraft(conversation.title || "");
    setEditingTitle(true);
    setError("");
  }

  function cancelRename() {
    setEditingTitle(false);
    setTitleDraft("");
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !titleDraft.trim() || savingTitle) return;

    setSavingTitle(true);
    setError("");
    try {
      const updated = await updateConversation(conversation.id, titleDraft.trim());
      setConversation((current) => current ? { ...current, title: updated.title, updatedAt: updated.updatedAt } : current);
      setConversations((current) => current.map((item) => item.id === updated.id ? updated : item));
      cancelRename();
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setError(errorMessage(requestError, "Could not rename this conversation."));
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !question.trim() || asking) return;

    const content = question.trim();
    setQuestion("");
    setAsking(true);
    setError("");

    try {
      await askRepository(repositoryId, conversation.id, content);
      await loadConversation(conversation.id);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? { ...item, updatedAt: new Date().toISOString() }
            : item,
        ),
      );
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        router.replace("/sign-in");
        return;
      }
      setError(errorMessage(requestError, "Could not get an answer. Try again."));
    } finally {
      setAsking(false);
    }
  }

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [conversations],
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c0a10] text-zinc-400">
        <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading chat workspace...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0c0a10] px-3 py-4 text-white sm:px-6 sm:py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/dashboard")} aria-label="Back to dashboard" className="text-zinc-400 hover:text-white">
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <p className="font-mono text-xs tracking-[0.18em] text-zinc-500">REPOSITORY CHAT</p>
              <h1 className="truncate text-xl font-semibold sm:text-2xl">{repository?.name}</h1>
            </div>
          </div>
          <span className="text-xs text-zinc-500">History is saved to your account</span>
        </header>

        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}
          </div>
        ) : null}

        <div className="grid min-h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2 px-2 pb-3">
              <h2 className="text-sm font-medium">Conversations</h2>
              <Button type="button" size="sm" onClick={() => void handleNewChat()} disabled={creating || repository?.status !== "READY"} className="bg-white text-zinc-950 hover:bg-zinc-200">
                {creating ? <LoaderCircle className="animate-spin" /> : <MessageSquarePlus />}
                New chat
              </Button>
            </div>

            {sortedConversations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-zinc-500">
                No saved conversations yet.
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
                {sortedConversations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void loadConversation(item.id)}
                    className={`min-w-52 flex-1 rounded-lg border p-3 text-left transition-colors lg:min-w-0 ${selectedId === item.id ? "border-orange-400/30 bg-orange-400/10" : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"}`}
                  >
                    <p className="truncate text-sm font-medium text-zinc-200">{item.title || "Untitled conversation"}</p>
                    <p className="mt-1 text-xs text-zinc-500">{formatTime(item.updatedAt)}</p>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="flex min-h-[620px] min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.035]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                {conversation && editingTitle ? (
                  <form onSubmit={handleRename} className="flex max-w-xl items-center gap-2">
                    <Input
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      maxLength={200}
                      autoFocus
                      aria-label="Conversation title"
                      className="h-9 border-white/15 bg-black/20 text-white"
                    />
                    <Button type="submit" size="icon-sm" disabled={savingTitle || !titleDraft.trim()} aria-label="Save conversation name" className="bg-white text-zinc-950 hover:bg-zinc-200">
                      {savingTitle ? <LoaderCircle className="animate-spin" /> : <Check />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={cancelRename} disabled={savingTitle} aria-label="Cancel renaming" className="text-zinc-400 hover:text-white">
                      <X />
                    </Button>
                  </form>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate font-medium">{conversation?.title || "New conversation"}</h2>
                    {conversation ? <Button type="button" variant="ghost" size="icon-xs" onClick={startRename} aria-label="Rename conversation" className="text-zinc-500 hover:text-white"><Pencil /></Button> : null}
                  </div>
                )}
                <p className="text-xs text-zinc-500">Ask questions about the indexed codebase.</p>
              </div>
              {conversation ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => void handleDelete()} disabled={deleting} aria-label="Delete conversation" className="text-zinc-500 hover:bg-red-400/10 hover:text-red-300">
                  {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                </Button>
              ) : null}
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {!conversation ? (
                <div className="flex min-h-80 items-center justify-center text-center">
                  <div>
                    <MessageSquarePlus className="mx-auto size-8 text-zinc-600" />
                    <p className="mt-3 font-medium text-zinc-300">Start a repository conversation</p>
                    <p className="mt-1 text-sm text-zinc-500">Create a chat to persist questions and answers.</p>
                  </div>
                </div>
              ) : loadingMessages ? (
                <div className="flex items-center justify-center py-20 text-sm text-zinc-500"><LoaderCircle className="mr-2 size-4 animate-spin" /> Loading messages...</div>
              ) : conversation.messages.length === 0 ? (
                <div className="flex min-h-80 items-center justify-center text-center">
                  <div>
                    <p className="font-medium text-zinc-300">No messages yet</p>
                    <p className="mt-1 text-sm text-zinc-500">Ask where a feature or function lives in the repository.</p>
                  </div>
                </div>
              ) : (
                conversation.messages.map((message) => {
                  const sources = getSources(message);
                  return (
                    <article key={message.id} className={message.role === "USER" ? "ml-auto max-w-3xl" : "max-w-4xl"}>
                      <div className={`rounded-2xl border p-4 ${message.role === "USER" ? "border-orange-400/20 bg-orange-400/10" : "border-white/10 bg-black/20"}`}>
                        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{message.role === "USER" ? "You" : "DevSage"}</p>
                        <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{message.content}</div>
                        <p className="mt-3 text-xs text-zinc-600">{formatTime(message.createdAt)}</p>
                      </div>
                      {sources.length > 0 ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {sources.map((source, index) => {
                            const sourceUrl = repository
                              ? `https://github.com/${repository.githubOwner}/${repository.githubName}/blob/${repository.defaultBranch}/${source.file_path}#L${source.start_line}-L${source.end_line}`
                              : "#";
                            return (
                              <a key={`${source.file_path}-${source.start_line}-${index}`} href={sourceUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs transition-colors hover:border-white/25 hover:bg-white/[0.06]">
                                <code className="break-all text-zinc-300">{source.file_path}</code>
                                <span className="mt-1 block text-zinc-500">Lines {source.start_line}–{source.end_line}</span>
                              </a>
                            );
                          })}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
              {asking ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500" aria-live="polite"><LoaderCircle className="size-4 animate-spin" /> DevSage is searching the repository...</div>
              ) : null}
            </div>

            <form onSubmit={handleAsk} className="border-t border-white/10 p-4 sm:p-6">
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} disabled={!conversation || asking} placeholder={conversation ? "Ask about the repository..." : "Create a conversation to start asking questions"} className="min-h-24 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-white/30 focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-60" />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-zinc-600">{question.length}/2000 characters</span>
                <Button type="submit" disabled={!canAsk || asking} className="w-full bg-white text-zinc-950 hover:bg-zinc-200 sm:w-auto">
                  {asking ? <LoaderCircle className="animate-spin" /> : <Send />}
                  {asking ? "Thinking..." : "Ask DevSage"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

function RepositoryChatRoute() {
  const params = useParams<{ repositoryId: string }>();
  const repositoryId = typeof params.repositoryId === "string" ? params.repositoryId : "";

  return repositoryId ? <ChatWorkspace repositoryId={repositoryId} /> : null;
}

export default function RepositoryChatPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#0c0a10] text-zinc-400">Loading chat workspace...</main>}>
        <RepositoryChatRoute />
      </Suspense>
    </AuthGuard>
  );
}
