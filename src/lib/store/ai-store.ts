"use client";

import { create } from "zustand";

import { createAiSession, fetchAiStatus } from "@/lib/ai/client";
import type { AiStatusResponse } from "@/lib/ai/contracts";

const AI_SESSION_STORAGE_KEY = "__pschedule_ai_session__";

interface StoredAiSession {
  token: string;
  expiresAt: string;
}

interface AiStoreState {
  token: string | null;
  expiresAt: string | null;
  status: AiStatusResponse | null;
  statusError: string | null;
  hydrating: boolean;
  hydrate: () => void;
  refreshStatus: () => Promise<void>;
  signIn: (password: string) => Promise<void>;
  signOut: () => void;
}

function loadStoredSession(): StoredAiSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(AI_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredAiSession;
    if (!parsed.token || !parsed.expiresAt) {
      return null;
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(AI_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(AI_SESSION_STORAGE_KEY);
    return null;
  }
}

function persistSession(session: StoredAiSession | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!session) {
    window.sessionStorage.removeItem(AI_SESSION_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(AI_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export const useAiStore = create<AiStoreState>((set) => ({
  token: null,
  expiresAt: null,
  status: null,
  statusError: null,
  hydrating: true,
  hydrate: () => {
    const session = loadStoredSession();
    set({
      token: session?.token ?? null,
      expiresAt: session?.expiresAt ?? null,
      hydrating: false,
    });
  },
  refreshStatus: async () => {
    try {
      const status = await fetchAiStatus();
      set({
        status,
        statusError: null,
      });
    } catch (error) {
      set({
        status: null,
        statusError: error instanceof Error ? error.message : "Failed to reach the AI backend.",
      });
    }
  },
  signIn: async (password) => {
    const session = await createAiSession(password);
    persistSession(session);
    set({
      token: session.token,
      expiresAt: session.expiresAt,
    });
  },
  signOut: () => {
    persistSession(null);
    set({
      token: null,
      expiresAt: null,
    });
  },
}));
