import { create } from "zustand";
import { AxiosError } from "axios";
import { generationApi } from "../api/generation";
import type { GenerateSpriteRequest, Generation } from "../types/models";

type GenerationState = {
  loading: boolean;
  current: Generation | null;
  history: Generation[];
  pollingGenerationId: string | null;
  error: string | null;
  fetchHistory: () => Promise<void>;
  loadGeneration: (generationId: string) => Promise<Generation>;
  generate: (payload: GenerateSpriteRequest) => Promise<{ queued: boolean; generationId: string }>;
  regenerate: (generationId: string) => Promise<{ queued: boolean; generationId: string }>;
  pollUntilSettled: (generationId: string) => Promise<Generation>;
  deleteGeneration: (generationId: string) => Promise<void>;
  setCurrent: (generation: Generation | null) => void;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractFailedGeneration = (error: unknown): Generation | null => {
  if (!(error instanceof AxiosError)) return null;
  if (error.response?.status !== 422) return null;

  const payload = error.response.data as unknown;
  if (!payload || typeof payload !== "object") return null;
  if (!("generation" in payload)) return null;

  const generation = (payload as { generation?: unknown }).generation;
  if (!generation || typeof generation !== "object") return null;
  if (!("id" in generation)) return null;
  return generation as Generation;
};

export const useGenerationStore = create<GenerationState>((set) => ({
  loading: false,
  current: null,
  history: [],
  pollingGenerationId: null,
  error: null,
  fetchHistory: async () => {
    const history = await generationApi.listHistory();
    set({ history });
  },
  loadGeneration: async (generationId) => {
    const generation = await generationApi.getGeneration(generationId);
    set({ current: generation });
    return generation;
  },
  generate: async (payload) => {
    set({ loading: true, error: null });
    try {
      const response = await generationApi.generateSprite(payload);
      if (response.queued) {
        set({ loading: false, pollingGenerationId: response.generationId });
        return {
          queued: true,
          generationId: response.generationId
        };
      }

      set((state) => ({
        loading: false,
        current: response.generation,
        history: [response.generation, ...state.history.filter((item) => item.id !== response.generation.id)]
      }));

      return {
        queued: false,
        generationId: response.generation.id
      };
    } catch (error) {
      const failedGeneration = extractFailedGeneration(error);
      if (failedGeneration) {
        set((state) => ({
          loading: false,
          current: failedGeneration,
          history: [failedGeneration, ...state.history.filter((item) => item.id !== failedGeneration.id)],
          error: null
        }));
        return {
          queued: false,
          generationId: failedGeneration.id
        };
      }

      const apiMessage =
        error instanceof AxiosError && typeof error.response?.data?.message === "string"
          ? error.response.data.message
          : error instanceof Error
            ? error.message
            : "Generation failed";
      set({ loading: false, error: apiMessage });
      throw new Error(apiMessage);
    }
  },
  regenerate: async (generationId) => {
    set({ loading: true, error: null });
    try {
      const response = await generationApi.regenerate(generationId);

      if (response.queued) {
        set({ loading: false, pollingGenerationId: response.generationId });
        return {
          queued: true,
          generationId: response.generationId
        };
      }

      set((state) => ({
        loading: false,
        current: response.generation,
        history: [response.generation, ...state.history.filter((item) => item.id !== response.generation.id)]
      }));

      return {
        queued: false,
        generationId: response.generation.id
      };
    } catch (error) {
      const failedGeneration = extractFailedGeneration(error);
      if (failedGeneration) {
        set((state) => ({
          loading: false,
          current: failedGeneration,
          history: [failedGeneration, ...state.history.filter((item) => item.id !== failedGeneration.id)],
          error: null
        }));
        return {
          queued: false,
          generationId: failedGeneration.id
        };
      }

      const apiMessage =
        error instanceof AxiosError && typeof error.response?.data?.message === "string"
          ? error.response.data.message
          : error instanceof Error
            ? error.message
            : "Regeneration failed";
      set({ loading: false, error: apiMessage });
      throw new Error(apiMessage);
    }
  },
  pollUntilSettled: async (generationId) => {
    set({ pollingGenerationId: generationId, error: null });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const generation = await generationApi.getJobStatus(generationId);

      set((state) => ({
        current: generation,
        history: [generation, ...state.history.filter((item) => item.id !== generation.id)]
      }));

      if (generation.status === "completed" || generation.status === "failed") {
        set({ pollingGenerationId: null });
        return generation;
      }

      await delay(2500);
    }

    set({ pollingGenerationId: null });
    throw new Error("Generation polling timeout");
  },
  deleteGeneration: async (generationId) => {
    await generationApi.deleteGeneration(generationId);
    set((state) => ({
      history: state.history.filter((item) => item.id !== generationId),
      current: state.current?.id === generationId ? null : state.current
    }));
  },
  setCurrent: (generation) => {
    set({ current: generation });
  }
}));
