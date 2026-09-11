import { create } from "zustand";

import { CATALOG } from "@/lib/catalog";
import * as ipc from "@/lib/ipc";
import { applyTheme, syncTheme } from "@/lib/theme";
import type { CatalogEntry, CatalogResponse, Prefs, PrefsDiff } from "@/types";

/**
 * 应用目录的数据源。
 *
 * 展示元数据优先用远端目录（可在不改客户端的情况下更新文案），
 * 内置 CATALOG 作为兜底与字段补全：
 * - 远端条目缺字段（远端 JSON 没发的）回落 builtin 同 id 条目的值
 * - 远端没覆盖的应用仍显示 builtin 条目——检测/安装不依赖展示元数据
 */
interface CatalogState {
  /** 合成后的展示目录（远端覆盖 + builtin 兜底），按 builtin 顺序稳定排列。 */
  entries: CatalogEntry[];
  source: CatalogResponse["source"];
  note: string | null;
  loading: boolean;
  /** 用户偏好（设置页消费）；null = 尚未加载。 */
  prefs: Prefs | null;

  loadCatalog: () => Promise<void>;
  setPrefs: (diff: PrefsDiff) => Promise<void>;
}

/** 远端条目覆盖到 builtin 条目上，缺的字段保留 builtin 值。 */
function mergeEntries(
  remote: CatalogResponse["entries"],
): CatalogEntry[] {
  const byId = new Map(remote.map((entry) => [entry.id, entry]));
  return CATALOG.map((builtin) => {
    const remoteEntry = byId.get(builtin.id);
    if (!remoteEntry) return builtin;

    return {
      ...builtin,
      name: remoteEntry.name || builtin.name,
      vendor: remoteEntry.vendor || builtin.vendor,
      tagline: remoteEntry.tagline || builtin.tagline,
      description: remoteEntry.description || builtin.description,
      initials: remoteEntry.initials || builtin.initials,
      tags: remoteEntry.tags.length > 0 ? remoteEntry.tags : builtin.tags,
      homepage: remoteEntry.homepage || builtin.homepage,
      docs: remoteEntry.docs || builtin.docs,
    };
  });
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  entries: CATALOG,
  source: "builtin",
  note: null,
  loading: true,
  prefs: null,

  loadCatalog: async () => {
    set({ loading: true });

    // 偏好与目录并行取；偏好失败不阻塞目录（目录回落 builtin）
    const prefsPromise = ipc
      .getPrefs()
      .then((prefs) => {
        set({ prefs });
        // 偏好加载后校正主题（M1.1）：initTheme 用的是 localStorage 缓存，
        // 这里以 prefs.json 真值为准刷新一次
        syncTheme(prefs);
        return prefs;
      })
      .catch(() => null);

    try {
      const response = await ipc.getCatalog();
      set({
        entries: mergeEntries(response.entries),
        source: response.source,
        note: response.note,
        loading: false,
      });
    } catch {
      // IPC 层面失败（不该发生）：保持 builtin，来源如实标注
      set({
        entries: CATALOG,
        source: "builtin",
        note: JSON.stringify({ code: "catalogFetchFailed" }),
        loading: false,
      });
    }

    await prefsPromise;
  },

  setPrefs: async (diff) => {
    // 乐观更新：设置页 UI 立即反馈，失败再回滚到旧快照
    const previous = get().prefs;
    if (previous) {
      set({
        prefs: {
          ...previous,
          ...diff,
          proxy: { ...previous.proxy, ...diff.proxy },
        },
      });
    }

    try {
      const prefs = await ipc.setPrefs(diff);
      set({ prefs });
      if (diff.theme !== undefined) {
        // 主题切换立即生效（不重启）
        applyTheme(prefs.theme);
      }
      // 代理 / 目录源地址变化会影响目录获取行为，重新拉一次
      if (
        diff.catalogUrl !== undefined ||
        diff.catalogTtlHours !== undefined ||
        diff.proxy !== undefined
      ) {
        await get().loadCatalog();
      }
    } catch (err) {
      if (previous) set({ prefs: previous });
      // 回滚时把旧主题也还原
      if (diff.theme !== undefined && previous) {
        applyTheme(previous.theme);
      }
      throw err;
    }
  },
}));
