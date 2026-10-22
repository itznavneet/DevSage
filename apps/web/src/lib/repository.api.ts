
import { api } from "./api";

export interface Repository {
  id: string;
  name: string;
  url: string;
  githubOwner: string;
  githubName: string;
  status: "PENDING" | "CLONING" | "INDEXING" | "READY" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
}

export async function getRepositories() {
  const response = await api.get<{ repositories: Repository[] }>(
    "/api/repositories"
  );

  return response.data.repositories;
}

export async function addRepository(url: string) {
  const response = await api.post<{ repository: Repository }>(
    "/api/repositories",
    { url }
  );

  return response.data.repository;
}
