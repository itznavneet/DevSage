
import { api } from "./api";

export interface AuthUser {
  id: string;
  name: string | null;
  email: string;
}

interface AuthResponse {
  user: AuthUser;
}

export async function registerUser(data: {
  name: string;
  email: string;
  password: string;
}) {
  const response = await api.post<AuthResponse>("/api/auth/register", data);
  return response.data.user;
}

export async function loginUser(data: {
  email: string;
  password: string;
}) {
  const response = await api.post<AuthResponse>("/api/auth/login", data);
  return response.data.user;
}

export async function getCurrentUser() {
  const response = await api.get<AuthResponse>("/api/auth/me");
  return response.data.user;
}

export async function logoutUser() {
  await api.post("/api/auth/logout");
}
