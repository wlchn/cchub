import { describeError } from "@/lib/errors";
import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import type { HostConfig, McpService, McpTestResult, McpWriteRequest } from "@/types";

interface McpState {
  services: McpService[];
  /** 每宿主的配置（host id → HostConfig）。 */
  hosts: Record<string, HostConfig>;
  loading: boolean;
  error: string | null;
  /** 每个服务的操作状态（写入/移除），key = hostId/serviceId。 */
  ops: Record<string, { running: boolean; error: string | null }>;
  tests: Record<string, McpTestResult | null>;

  load: () => Promise<void>;
  add: (hostId: string, id: string, request?: McpWriteRequest) => Promise<void>;
  remove: (hostId: string, id: string) => Promise<void>;
  test: (id: string) => Promise<void>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  services: [],
  hosts: {},
  loading: true,
  error: null,
  ops: {},
  tests: {},

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [services, ...hostConfigs] = await Promise.all([
        ipc.listMcpServices(),
        ...ipc.MCP_HOSTS.map((h) => ipc.readHostConfig(h.id)),
      ]);
      const hosts: Record<string, HostConfig> = {};
      ipc.MCP_HOSTS.forEach((h, i) => {
        hosts[h.id] = hostConfigs[i];
      });
      set({ services, hosts, loading: false });
    } catch (err) {
      set({ loading: false, error: describeError(err) });
    }
  },

  add: async (hostId, id, request) => {
    const k = `${hostId}/${id}`;
    set({ ops: { ...get().ops, [k]: { running: true, error: null } } });
    try {
      const host = await ipc.writeMcpService(hostId, id, request);
      set({
        hosts: { ...get().hosts, [hostId]: host },
        ops: { ...get().ops, [k]: { running: false, error: null } },
      });
    } catch (err) {
      set({
        ops: { ...get().ops, [k]: { running: false, error: describeError(err) } },
      });
    }
  },

  remove: async (hostId, id) => {
    const k = `${hostId}/${id}`;
    set({ ops: { ...get().ops, [k]: { running: true, error: null } } });
    try {
      const host = await ipc.removeMcpService(hostId, id);
      set({
        hosts: { ...get().hosts, [hostId]: host },
        ops: { ...get().ops, [k]: { running: false, error: null } },
      });
    } catch (err) {
      set({
        ops: { ...get().ops, [k]: { running: false, error: describeError(err) } },
      });
    }
  },

  test: async (id) => {
    set({ tests: { ...get().tests, [id]: null } });
    const result = await ipc.testMcpService(id);
    set({ tests: { ...get().tests, [id]: result } });
  },
}));
