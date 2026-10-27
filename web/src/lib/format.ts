export function fmtDateTime(iso: string | null | undefined, tz = 'America/Sao_Paulo'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined, tz = 'America/Sao_Paulo'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, timeStyle: 'short' }).format(new Date(iso));
}

export function fmtDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}

export function dayLabel(d: { label?: string; date: string; room?: string | null; eventName?: string }): string {
  return [d.eventName, d.label, fmtDate(d.date), d.room].filter(Boolean).join(' · ');
}

export function minutes(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** Tamanho de arquivo legível: "850 KB", "2,4 MB". */
export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
