"use client";

import { useState, useEffect } from "react";
import { Shield, Trash2, Plus, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Loader2, Globe, Database } from "lucide-react";

type Proxy = {
  id: string;
  url: string;
  username: string | null;
  isActive: boolean;
  failCount: number;
  successCount: number;
  blockedCount: number;
  cooldownUntil: string | null;
  avgLatencyMs: number | null;
  lastError: string | null;
  lastUsed: string | null;
};

export default function ProxyPoolManager() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [bulkInput, setBulkInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  const fetchProxies = async () => {
    try {
      const res = await fetch('/api/admin-settings/proxy-pool');
      const data = await res.json();
      setProxies(data.proxies || []);
    } catch (e) {}
  };

  useEffect(() => {
    fetchProxies();
  }, []);

  const handleBulkAdd = async () => {
    if (!bulkInput.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch('/api/admin-settings/proxy-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: bulkInput })
      });
      const data = await res.json();
      if (data.ok) {
        setStatus({ type: 'success', msg: `Добавлено ${data.count} прокси` });
        setBulkInput("");
        setShowAdd(false);
        fetchProxies();
      } else {
        setStatus({ type: 'error', msg: data.error || "Ошибка" });
      }
    } catch (e) {
      setStatus({ type: 'error', msg: "Ошибка сети" });
    } finally {
      setLoading(false);
    }
  };

  const deleteProxy = async (id: string) => {
    if (!confirm("Удалить?")) return;
    await fetch(`/api/admin-settings/proxy-pool?id=${id}`, { method: 'DELETE' });
    fetchProxies();
  };

  return (
    <div className="premium-card bg-white border-slate-200 shadow-sm overflow-hidden mb-8">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Proxy</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Активных прокси: {proxies.length}</span>
              {status && (
                <span className={`text-[10px] font-black uppercase ${status.type === 'success' ? 'text-emerald-500' : 'text-rose-500'}`}>
                  • {status.msg}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {!collapsed && (
            <button 
            onClick={() => setShowAdd(!showAdd)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${showAdd ? 'bg-slate-950 text-white' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
            >
              {showAdd ? 'Закрыть' : 'Добавить прокси'}
              {showAdd ? <ChevronUp className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            </button>
          )}
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900"
            aria-label={collapsed ? "Развернуть Proxy" : "Свернуть Proxy"}
            title={collapsed ? "Развернуть" : "Свернуть"}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Add Section (Collapsible) */}
      {!collapsed && showAdd && (
        <div className="p-6 bg-slate-50/50 border-b border-slate-100">
          <textarea 
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            placeholder="Вставьте ссылки (одна на строку)..."
            className="w-full min-h-[80px] rounded-xl border border-slate-200 bg-white p-3 text-xs font-mono outline-none focus:border-indigo-500 transition-all mb-3"
          />
          <button 
            onClick={handleBulkAdd}
            disabled={loading || !bulkInput.trim()}
            className="w-full h-10 rounded-xl bg-indigo-600 text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-700 disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Загрузить в пул"}
          </button>
        </div>
      )}

      {/* List Section */}
      {!collapsed && (
        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
          {proxies.length === 0 ? (
            <div className="p-8 text-center">
              <Database className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Пул пуст. Добавьте прокси для работы.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {proxies.map((proxy) => (
                <div key={proxy.id} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50/50 transition-colors group">
                  <div className="flex items-center gap-4 min-w-0">
                    <Globe className="w-3.5 h-3.5 text-slate-300" />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black text-slate-900 truncate">
                          {proxy.username?.split('-session')[0] || proxy.url}
                        </span>
                        {/* Tags */}
                        {proxy.username?.split('-').map(part => {
                          // Парсим страну (country-us -> 🇺🇸 US)
                          if (part.startsWith('country')) {
                            const code = part.replace('country', '').replace('-', '').toUpperCase();
                            // Функция для получения эмодзи флага из кода страны
                            const getFlag = (cc: string) => {
                              if (cc.length !== 2) return '🌍';
                              return cc.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
                            };
                            return <span key={part} className="px-1.5 py-0.5 rounded bg-blue-50 text-[9px] font-black text-blue-600 uppercase border border-blue-100 flex items-center gap-1">{getFlag(code)} {code}</span>;
                          }
                          // Парсим тип (type-mobile -> 📱 MOBILE)
                          if (part.startsWith('type')) {
                            const platform = part.replace('type', '').replace('-', '').toLowerCase();
                            const isMobile = platform.includes('mobile');
                            return (
                              <span key={part} className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border flex items-center gap-1 ${isMobile ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                {isMobile ? '📱' : '🏠'} {platform}
                              </span>
                            );
                          }
                          return null;
                        })}
                      </div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                        Последнее исп: {proxy.lastUsed ? new Date(proxy.lastUsed).toLocaleTimeString() : '—'}
                        {proxy.avgLatencyMs ? ` • avg ${proxy.avgLatencyMs}ms` : ""}
                        {proxy.cooldownUntil && new Date(proxy.cooldownUntil) > new Date() ? " • cooldown" : ""}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                        OK: {proxy.successCount} • FAIL: {proxy.failCount} • BLOCK: {proxy.blockedCount}
                        {proxy.lastError ? ` • ${proxy.lastError.slice(0, 80)}` : ""}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => deleteProxy(proxy.id)}
                    className="p-2 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
