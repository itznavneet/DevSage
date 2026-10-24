
import {api} from "./api";

export interface AskRepositoryResponse {
  repository: {
    id: string;
    name: string;
  };
  answer: string;
  sources: {
    file_path: string;
    start_line: number;
    end_line: number;
    score: number;
  }[];
}

export async function askRepository(
  repositoryId: string,
  question: string
): Promise<AskRepositoryResponse> {
  const response = await api.post<AskRepositoryResponse>(
    `/api/ai/repositories/${encodeURIComponent(repositoryId)}/ask`,
    { question }
  );

  return response.data;
}
