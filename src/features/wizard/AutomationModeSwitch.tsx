import { useT } from "@/i18n";
import type { AutomationMode } from "@/stores/projectStore";

interface AutomationModeSwitchProps {
  mode: AutomationMode;
  onChange: (mode: AutomationMode) => void;
}

export function AutomationModeSwitch({ mode, onChange }: AutomationModeSwitchProps) {
  const t = useT();

  const modes: Array<{ value: AutomationMode; label: string; hint: string }> = [
    { value: 'semi-auto', label: t("automation.semi-auto"), hint: t("automation.semi-autoHint") },
    { value: 'auto', label: t("automation.auto"), hint: t("automation.autoHint") },
    { value: 'manual', label: t("automation.manual"), hint: t("automation.manualHint") },
  ];

  const currentHint = modes.find((m) => m.value === mode)?.hint ?? "";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === m.value
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>
      {/* 当前模式说明，替代仅靠 hover tooltip */}
      <span className="text-[10px] text-slate-500">{currentHint}</span>
    </div>
  );
}
