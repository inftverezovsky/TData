"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authenticatedRequest, type RequestAuthentication } from "@/services/authenticatedRequest";
import { AdminLoginDialog } from "./AdminLoginDialog";
import { usePathname } from "next/navigation";

const AdminSessionContext = createContext<RequestAuthentication | null>(null);

/** Один login dialog обслуживает запросы страницы; при отмене или уходе ожидание завершается без повторной отправки. */
export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (authenticated: boolean) => void } | null>(null);
  const authenticate = useCallback(() => {
    if (pending.current) return pending.current.promise;
    let resolveLogin: (authenticated: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => { resolveLogin = resolve; });
    pending.current = { promise, resolve: resolveLogin };
    setOpen(true);
    return promise;
  }, []);

  useEffect(() => {
    setOpen(false);
    return () => {
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, [pathname]);

  function finish(authenticated: boolean) {
    pending.current?.resolve(authenticated);
    pending.current = null;
    setOpen(false);
  }

  return (
    <AdminSessionContext.Provider value={authenticate}>
      {children}
      <AdminLoginDialog open={open} onAuthenticated={() => finish(true)} onCancel={() => finish(false)} />
    </AdminSessionContext.Provider>
  );
}

export function useAuthenticatedRequest() {
  const authenticate = useContext(AdminSessionContext);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  return useCallback((url: string, init: RequestInit) => {
    if (!authenticate) throw new Error("Компонент отправки требует AdminSessionProvider.");
    return authenticatedRequest(url, init, async () => active.current && await authenticate() && active.current);
  }, [authenticate]);
}
