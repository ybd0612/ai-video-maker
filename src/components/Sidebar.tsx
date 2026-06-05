import { MessageSquare, Type, ImageIcon, Film, Upload, Settings, Trash2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { TaskManager } from "@/components/TaskManager";
import type { DragEvent } from 'react';
import { useT } from '@/i18n';

interface PaletteItemProps {
  nodeType: string;
  label: string;
  icon: typeof MessageSquare;
  color: string;
  description: string;
}

function PaletteItem({ nodeType, label, icon: Icon, color, description }: PaletteItemProps) {
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("application/wxhb-node", nodeType);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`group cursor-grab rounded-lg border border-slate-700 bg-slate-800/60 p-3 transition hover:border-slate-500 hover:bg-slate-800 active:cursor-grabbing`}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} className={color} />
        <span className="text-xs font-semibold text-slate-200">{label}</span>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">{description}</p>
    </div>
  );
}

export function Sidebar() {
  const openSettings = useSettingsStore((s) => s.setSettingsDialogOpen);
  const t = useT();
  const clearAll = useCanvasStore((s) => s.clearAll);
  const nodeCount = useCanvasStore((s) => s.nodes.length);

  return (
    <div className="flex h-full w-56 flex-col border-r border-slate-800 bg-slate-950">
      {/* Logo */}
      <div className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-sm font-bold text-slate-100">
          <span className="text-emerald-400">AI</span> Canvas
        </h1>
        <p className="text-[10px] text-slate-500">Infinite Canvas Creator</p>
      </div>

      {/* Node palette */}
      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
{t("sidebar.dragToCanvas")}
        </p>
        <div className="space-y-2">
          <PaletteItem
            nodeType="prompt"
            label={t("palette.prompt")}
            icon={MessageSquare}
            color="text-emerald-400"
            description={t("palette.prompt.desc")}
          />
          <PaletteItem
            nodeType="text"
            label={t("palette.text")}
            icon={Type}
            color="text-sky-400"
            description={t("palette.text.desc")}
          />
          <PaletteItem
            nodeType="image"
            label={t("palette.image")}
            icon={ImageIcon}
            color="text-violet-400"
            description={t("palette.image.desc")}
          />
          <PaletteItem
            nodeType="video"
            label={t("palette.video")}
            icon={Film}
            color="text-amber-400"
            description={t("palette.video.desc")}
          />
          <PaletteItem
            nodeType="upload"
            label={t("palette.upload")}
            icon={Upload}
            color="text-rose-400"
            description={t("palette.upload.desc")}
          />
        </div>
      </div>

      {/* Task Manager */}
      <TaskManager />

      {/* Footer actions */}
      <div className="border-t border-slate-800 p-3 space-y-1">
        <button
          onClick={() => openSettings(true)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
        >
<Settings size={13} /> {t("sidebar.settings")}
        </button>
        <button
          onClick={() => {
            if (nodeCount === 0 || confirm(t("sidebar.clearConfirm"))) {
              clearAll();
            }
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-red-400/70 transition hover:bg-red-950/40 hover:text-red-400"
        >
<Trash2 size={13} /> {t("sidebar.clearCanvas")}
        </button>
      </div>
    </div>
  );
}
