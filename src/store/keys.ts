import { describeError } from "@/lib/errors";
import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import type { KeyRef, ProviderId } from "@/types";

interface AddKeyState {
  running: boolean;
  error: string | null;
}

interface KeysState {
  refs: KeyRef[];
  loading: boolean;
  error: string | null;
  /** 每个 (provider, label) 的测试结果。 */
  tests: Record<string, { running: boolean; result: import("@/types").KeyTestResult | null }>;
  adding: AddKeyState;
  /** 每个条目正在显示的明文（10 秒自动恢复掩码由 UI 层处理）。 */
  revealed: Record<string, string>;

  load: () => Promise<void>;
  add: (provider: ProviderId, label: string, value: string) => Promise<boolean>;
  remove: (ref: KeyRef) => Promise<void>;
  test: (ref: KeyRef) => Promise<void>;
  reveal: (ref: KeyRef) => Promise<void>;
  mask: (ref: KeyRef) => void;
}

const keyOf = (ref: { provider: string; label: string }) => `${ref.provider}/${ref.label}`;

export const useKeysStore = create<KeysState>((set, get) => ({
  refs: [],
  loading: true,
  error: null,
  tests: {},
  adding: { running: false, error: null },
  revealed: {},

  load: async () => {
    set({ loading: true, error: null });
    try {
      const refs = await ipc.listKeyRefs();
      set({ refs, loading: false });
    } catch (err) {
      set({ loading: false, error: describeError(err) });
    }
  },

  add: async (provider, label, value) => {
    set({ adding: { running: true, error: null } });
    try {
      const refs = await ipc.saveKey(provider, label, value);
      set({ refs, adding: { running: false, error: null } });
      return true;
    } catch (err) {
      set({ adding: { running: false, error: describeError(err) } });
      return false;
    }
  },

  remove: async (ref) => {
    try {
      const refs = await ipc.deleteKey(ref.provider, ref.label);
      set({ refs });
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  test: async (ref) => {
    const k = keyOf(ref);
    set({ tests: { ...get().tests, [k]: { running: true, result: null } } });
    const result = await ipc.testKey(ref.provider, ref.label);
    set({ tests: { ...get().tests, [k]: { running: false, result } } });
  },

  reveal: async (ref) => {
    const k = keyOf(ref);
    try {
      const value = await ipc.revealKey(ref.provider, ref.label);
      set({ revealed: { ...get().revealed, [k]: value } });
      // 10 秒后自动恢复掩码：明文不该常驻 UI
      setTimeout(() => {
        const next = { ...get().revealed };
        delete next[k];
        set({ revealed: next });
      }, 10_000);
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  mask: (ref) => {
    const k = keyOf(ref);
    const next = { ...get().revealed };
    delete next[k];
    set({ revealed: next });
  },
}));
