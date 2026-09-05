/** Only bounded, redacted diagnostics may leave the worker through public run status. */
export function safeKhlSyncError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "Unknown KHL sync failure.";
  if (/prisma|database|postgres|connection|password|token|secret|credential/i.test(message)) {
    return "KHL operation failed; protected server diagnostics are required.";
  }
  return message.replace(/https?:\/\/\S+/g, "[source URL]").slice(0, 2_000);
}
