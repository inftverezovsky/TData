import { CheckCircle2, Loader2 } from "lucide-react";
import { getRecognitionStageStatus, getVisibleRecognitionStages } from "./recognitionModel";
import type { RecognitionStage } from "./types";

type Props = {
  recognitionStage: RecognitionStage;
  recognitionStepDetails: Partial<Record<RecognitionStage, string>>;
  parsing: boolean;
  onAbort: () => void;
};

/** Прогресс отражает фактически выполненную ветвь AI/OCR; кнопка отмены делегирует AbortController. */
export function ManualImportRecognitionProgress({ recognitionStage, recognitionStepDetails, parsing, onAbort }: Props) {
  if (recognitionStage === "idle") return null;
  const visibleRecognitionStages = getVisibleRecognitionStages(recognitionStage, recognitionStepDetails);
  return (
    <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-black text-slate-950">Ход распознавания</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
            {recognitionStage === "done" ? "готово" : "в процессе"}
          </span>
          {parsing && (
            <button
              type="button"
              onClick={onAbort}
              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-slate-50"
            >
              Отменить
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {visibleRecognitionStages.map((stage) => {
          const status = getRecognitionStageStatus(recognitionStage, stage.id, visibleRecognitionStages);
          const isActive = status === "active";
          const isDone = status === "done";
          return (
            <div
              key={stage.id}
              className={`rounded-xl border px-3 py-2 transition ${
                isActive
                  ? "border-indigo-200 bg-white text-indigo-700 shadow-sm"
                  : isDone
                    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                    : "border-slate-100 bg-white/60 text-slate-400"
              }`}
            >
              <div className="flex items-center gap-2">
                {isActive ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <div className="h-3.5 w-3.5 rounded-full border border-current opacity-40" />
                )}
                <span className="text-[10px] font-black uppercase tracking-widest">{stage.label}</span>
              </div>
              {recognitionStepDetails[stage.id] && (
                <p className="mt-1 text-[10px] font-bold leading-snug opacity-80">{recognitionStepDetails[stage.id]}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
