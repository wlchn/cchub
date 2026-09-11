import { describeError, describeNote } from "@/lib/errors";
import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import { catalogEntry } from "@/lib/catalog";
import type {
  AppId,
  AppStatus,
  EnvironmentInfo,
  LatestVersion,
  TaskKind,
  TaskLog,
} from "@/types";

/** 偏好快照（M1.2）：bootstrap 的门控行为读它，null = 未加载（按默认全开处理）。 */
export interface BehaviorPrefs {
  detectOnLaunch: boolean;
  checkUpdatesOnLaunch: boolean;
}

/** 单个应用正在进行/刚结束的任务。 */
export interface TaskState {
  kind: TaskKind;
  running: boolean;
  logs: TaskLog[];
  result?: { success: boolean; message: string };
}

interface AppsState {
  environment: EnvironmentInfo | null;
  statuses: Partial<Record<AppId, AppStatus>>;
  latest: Partial<Record<AppId, LatestVersion>>;
  tasks: Partial<Record<AppId, TaskState>>;

  /** 首屏检测是否还在进行。 */
  loading: boolean;
  /** 检测环节本身出错时的信息（区别于任务失败）。 */
  error: string | null;
  /** 是否已挂上事件监听。 */
  listening: boolean;
  /** 行为偏好快照（M1.2），bootstrap 门控用。 */
  behavior: BehaviorPrefs | null;

  bootstrap: (behavior?: BehaviorPrefs) => Promise<void>;
  refreshStatuses: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  runTask: (id: AppId, kind: TaskKind) => Promise<void>;
  clearTask: (id: AppId) => void;
}

/** 日志只保留尾部，避免一次 npm install 的输出把内存和渲染都拖垮。 */
const MAX_LOG_LINES = 400;

export const useAppsStore = create<AppsState>((set, get) => ({
  environment: null,
  statuses: {},
  latest: {},
  tasks: {},
  loading: true,
  error: null,
  listening: false,
  behavior: null,

  bootstrap: async (behavior) => {
    // 行为偏好（M1.2）：未加载（null）按全开默认处理，避免偏好加载失败
    // 导致首屏功能被静默关闭
    const effective: BehaviorPrefs =
      behavior ?? get().behavior ?? { detectOnLaunch: true, checkUpdatesOnLaunch: true };
    set({ behavior: effective });

    if (!get().listening) {
      set({ listening: true });

      await ipc.onTaskLog((payload) => {
        const task = get().tasks[payload.id];
        if (!task) return;

        const logs = [...task.logs, payload];
        set({
          tasks: {
            ...get().tasks,
            [payload.id]: {
              ...task,
              logs: logs.length > MAX_LOG_LINES ? logs.slice(-MAX_LOG_LINES) : logs,
            },
          },
        });
      });

      await ipc.onTaskFinished(async (payload) => {
        const task = get().tasks[payload.id];
        set({
          tasks: {
            ...get().tasks,
            [payload.id]: {
              kind: task?.kind ?? "install",
              logs: task?.logs ?? [],
              running: false,
              // 消息是后端结构化产出（成功是 notes、失败是 errors），按原样存的
              // 话英文界面会露出中文；这里的取舍与 describeError 一致 —— 在消息
              // 产生的那一刻定型，之后切语言不会回溯改写历史日志。
              result: {
                success: payload.success,
                message: payload.success
                  ? describeNote(payload.message)
                  : describeError(payload.message),
              },
            },
          },
        });

        // 装完/卸完立刻重新检测，让卡片状态与磁盘上的事实一致
        await get().refreshStatuses();
        if (payload.success) {
          void get().checkUpdates();
        }
      });
    }

    set({ loading: true, error: null });

    // detectOnLaunch 关闭时跳过首屏检测：环境横幅还需要 environment，
    // 但应用卡片显示「未安装」由用户手动刷新，这正是该偏好的语义
    if (!effective.detectOnLaunch) {
      set({ loading: false });
      return;
    }

    try {
      const [environment, statuses] = await Promise.all([
        ipc.detectEnvironment(),
        ipc.detectApps(),
      ]);

      set({
        environment,
        statuses: Object.fromEntries(statuses.map((s) => [s.id, s])),
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: describeError(err) });
      return;
    }

    // 版本检查要走网络，放在首屏渲染之后，不让它拖慢启动；
    // checkUpdatesOnLaunch 关闭时跳过（手动刷新按钮仍可用）
    if (effective.checkUpdatesOnLaunch) {
      void get().checkUpdates();
    }
  },

  refreshStatuses: async () => {
    try {
      const statuses = await ipc.detectApps();
      set({
        statuses: Object.fromEntries(statuses.map((s) => [s.id, s])),
        error: null,
      });
    } catch (err) {
      set({ error: describeError(err) });
    }
  },

  checkUpdates: async () => {
    const statuses = get().statuses;

    // 只查已安装且受 npm 管理的应用：未安装的没有「当前版本」可比，
    // External / 外部安装的 CCHub 也不负责更新，查了只会白跑网络。
    const ids = (Object.keys(statuses) as AppId[]).filter((id) => {
      const s = statuses[id];
      return s?.installed && s.managed;
    });

    // 换了一批查询对象后，清掉已不在查询范围内的旧结果，
    // 避免卸载后卡片上还挂着过时的「可更新」提示。
    set({ latest: Object.fromEntries(ids.map((id) => [id, get().latest[id]])) });

    await Promise.all(
      ids.map(async (id) => {
        try {
          const latest = await ipc.checkLatestVersion(id);
          set({ latest: { ...get().latest, [id]: latest } });
        } catch {
          // 版本检查失败不该影响主流程，卡片上不显示更新提示即可
        }
      }),
    );
  },

  runTask: async (id, kind) => {
    set({
      tasks: {
        ...get().tasks,
        [id]: { kind, running: true, logs: [], result: undefined },
      },
    });

    try {
      await ipc.runAppTask(id, kind);
    } catch (err) {
      const name = catalogEntry(id)?.name ?? id;
      set({
        tasks: {
          ...get().tasks,
          [id]: {
            kind,
            running: false,
            logs: get().tasks[id]?.logs ?? [],
            result: { success: false, message: `${name}：${describeError(err)}` },
          },
        },
      });
    }
  },

  clearTask: (id) => {
    const tasks = { ...get().tasks };
    delete tasks[id];
    set({ tasks });
  },
}));
