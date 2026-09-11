import { describeError } from "@/lib/errors";
import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import type { SkillEntry, SkillSource } from "@/types";

/** 单个 Skill 正在执行的操作。 */
interface SkillTaskState {
  kind: "install" | "uninstall" | "toggle";
  running: boolean;
  error: string | null;
}

interface SkillsState {
  entries: SkillEntry[];
  sources: SkillSource[];
  loading: boolean;
  /** 列表加载失败的错误信息。 */
  error: string | null;
  tasks: Record<string, SkillTaskState>;

  load: () => Promise<void>;
  install: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  entries: [],
  sources: [],
  loading: true,
  error: null,
  tasks: {},

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [entries, sources] = await Promise.all([
        ipc.listSkills(),
        ipc.listSkillSources(),
      ]);
      set({ entries, sources, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: describeError(err),
      });
    }
  },

  install: async (id) => {
    set({ tasks: { ...get().tasks, [id]: { kind: "install", running: true, error: null } } });
    try {
      const entries = await ipc.installSkill(id);
      set({ entries, tasks: { ...get().tasks, [id]: { kind: "install", running: false, error: null } } });
    } catch (err) {
      set({
        tasks: {
          ...get().tasks,
          [id]: { kind: "install", running: false, error: describeError(err) },
        },
      });
    }
  },

  setEnabled: async (id, enabled) => {
    // 乐观更新：开关切换要跟手，失败回滚
    const previous = get().entries;
    set({
      entries: previous.map((e) => (e.id === id ? { ...e, enabled } : e)),
    });
    try {
      const entries = await ipc.setSkillEnabled(id, enabled);
      set({ entries });
    } catch (err) {
      set({ entries: previous });
      set({
        tasks: {
          ...get().tasks,
          [id]: { kind: "toggle", running: false, error: describeError(err) },
        },
      });
    }
  },

  uninstall: async (id) => {
    set({ tasks: { ...get().tasks, [id]: { kind: "uninstall", running: true, error: null } } });
    try {
      const entries = await ipc.uninstallSkill(id);
      set({ entries, tasks: { ...get().tasks, [id]: { kind: "uninstall", running: false, error: null } } });
    } catch (err) {
      set({
        tasks: {
          ...get().tasks,
          [id]: { kind: "uninstall", running: false, error: describeError(err) },
        },
      });
    }
  },
}));
