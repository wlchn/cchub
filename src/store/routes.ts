import { describeError, describeNote } from "@/lib/errors";
import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import type { HostStateView, ProviderInfo, RouteRule } from "@/types";

interface RoutesState {
  rules: RouteRule[];
  /** 宿主 → 激活的预设 id。 */
  active: Record<string, string>;
  /** 宿主 → 实际生效配置（回读自宿主文件）。 */
  hosts: Record<string, HostStateView>;
  providers: ProviderInfo[];
  loading: boolean;
  error: string | null;
  /** 保存/删除/切换中。 */
  saving: boolean;
  /** 最近一次下发 / 切换的结果信息。 */
  lastApplied: string | null;

  load: () => Promise<void>;
  loadProviders: () => Promise<void>;
  save: (rule: RouteRule) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  switchTo: (id: string) => Promise<boolean>;
  clear: (appId: string) => Promise<void>;
  apply: () => Promise<void>;
}

export const useRoutesStore = create<RoutesState>((set) => ({
  rules: [],
  active: {},
  hosts: {},
  providers: [],
  loading: true,
  error: null,
  saving: false,
  lastApplied: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const state = await ipc.listRoutes();
      set({
        rules: state.rules,
        active: state.active,
        hosts: state.hosts,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: describeError(err) });
    }
  },

  loadProviders: async () => {
    try {
      const providers = await ipc.listProviders();
      set({ providers });
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  save: async (rule) => {
    set({ saving: true, error: null });
    try {
      const state = await ipc.saveRoute(rule);
      set({
        rules: state.rules,
        active: state.active,
        hosts: state.hosts,
        saving: false,
      });
      return true;
    } catch (err) {
      set({ saving: false, error: describeError(err) });
      return false;
    }
  },

  remove: async (id) => {
    set({ saving: true, error: null });
    try {
      const state = await ipc.deleteRoute(id);
      set({
        rules: state.rules,
        active: state.active,
        hosts: state.hosts,
        saving: false,
      });
    } catch (err) {
      set({ saving: false, error: describeError(err) });
    }
  },

  switchTo: async (id) => {
    set({ saving: true, error: null, lastApplied: null });
    try {
      const message = await ipc.switchRoute(id);
      // 切换成功后重拉（active 与宿主回读在 Rust 侧已更新）
      const state = await ipc.listRoutes();
      set({
        rules: state.rules,
        active: state.active,
        hosts: state.hosts,
        saving: false,
        lastApplied: describeNote(message),
      });
      return true;
    } catch (err) {
      set({ saving: false, error: describeError(err) });
      return false;
    }
  },

  clear: async (appId) => {
    set({ saving: true, error: null, lastApplied: null });
    try {
      const message = await ipc.clearRoute(appId);
      const state = await ipc.listRoutes();
      set({
        rules: state.rules,
        active: state.active,
        hosts: state.hosts,
        saving: false,
        lastApplied: describeNote(message),
      });
    } catch (err) {
      set({ saving: false, error: describeError(err) });
    }
  },

  apply: async () => {
    set({ saving: true, error: null, lastApplied: null });
    try {
      const message = await ipc.applyRoutes();
      const state = await ipc.listRoutes();
      set({
        rules: state.rules,
        active: state.active,
        hosts: state.hosts,
        saving: false,
        lastApplied: describeNote(message),
      });
    } catch (err) {
      set({ saving: false, error: describeError(err) });
    }
  },
}));

/** 把 keyRef 转成路由用的引用串。 */
export function keyRefOf(ref: { provider: string; label: string }): string {
  return `@keychain:${ref.provider}/${ref.label}`;
}
