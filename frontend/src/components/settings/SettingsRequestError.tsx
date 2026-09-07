type Props = { message: string; onRetry?: () => void };

/** Сообщение остаётся на экране; при ошибке загрузки можно повторить запрос без перезагрузки страницы. */
export function SettingsRequestError({ message, onRetry }: Props) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs">
          Повторить загрузку настроек
        </button>
      )}
    </div>
  );
}
