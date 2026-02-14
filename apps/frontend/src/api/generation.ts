import { apiClient } from "./http";
import type { GenerateSpriteRequest, GenerateSpriteResponse, Generation } from "../types/models";

export const generationApi = {
  generateSprite: async (payload: GenerateSpriteRequest) => {
    const { data } = await apiClient.post<GenerateSpriteResponse>("/generate/sprite", payload);
    return data;
  },
  getJobStatus: async (generationId: string) => {
    const { data } = await apiClient.get<{ generation: Generation }>(`/generate/jobs/${generationId}`);
    return data.generation;
  },
  getGeneration: async (generationId: string) => {
    const { data } = await apiClient.get<{ generation: Generation }>(`/generate/${generationId}`);
    return data.generation;
  },
  listHistory: async () => {
    const { data } = await apiClient.get<{ generations: Generation[] }>("/generate/history");
    return data.generations;
  },
  deleteGeneration: async (generationId: string) => {
    await apiClient.delete(`/generate/${generationId}`);
  },
  regenerate: async (generationId: string) => {
    const { data } = await apiClient.post<GenerateSpriteResponse>(`/generate/${generationId}/regenerate`);
    return data;
  }
};
