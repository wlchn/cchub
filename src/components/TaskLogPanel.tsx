import { useEffect, useRef } from "react";

import { describeNote } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { TaskLog } from "@/types";

interface TaskLogPanelProps {
  logs: TaskLog[];
  className?: string;
}

const STREAM_STYLES: Record<TaskLog["stream"], string> = {
  info: "text-foreground",
  stdout: "text-muted-foreground",
  stderr: "text-destructive",
};

export function TaskLogPanel({ logs, className }: TaskLogPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // 日志追加时贴住底部，跟着最新一行走
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

  if (logs.length === 0) return null;

  return (
    <div
      className={cn("bg-muted max-h-40 overflow-y-auto rounded-md p-3", className)}
      data-selectable
    >
      <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {logs.map((log, i) => (
          <div key={i} className={STREAM_STYLES[log.stream]}>
            {/* 只有 info 是我们自己产出的结构化消息；stdout/stderr 是子进程原文，
                翻译它们既没意义、又可能误伤恰好是 JSON 的输出 */}
            {log.stream === "info" ? describeNote(log.line) : log.line}
          </div>
        ))}
      </pre>
      <div ref={endRef} />
    </div>
  );
}
