export class TLineJobLeaseLostError extends Error {
  constructor(cause?: unknown) {
    super("TLine job lease ownership was lost.");
    this.name = "TLineJobLeaseLostError";
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause, enumerable: false });
  }
}

export function createTLineLeaseGuard() {
  const controller = new AbortController();

  return {
    signal: controller.signal,
    lose(cause?: unknown) {
      if (!controller.signal.aborted) controller.abort(new TLineJobLeaseLostError(cause));
    },
    assertOwned() {
      if (!controller.signal.aborted) return;
      const reason = controller.signal.reason;
      throw reason instanceof TLineJobLeaseLostError ? reason : new TLineJobLeaseLostError(reason);
    },
  };
}
