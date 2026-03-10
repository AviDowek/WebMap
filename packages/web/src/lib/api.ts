import { API_BASE } from "./constants";

export async function fetchAPI(
  path: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, options);
}
