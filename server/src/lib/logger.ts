/**
 * Log terstruktur. Production (atau LOG_FORMAT=json): satu baris JSON per kejadian, siap dibaca
 * `docker compose logs`, Loki/Promtail, atau layanan log lain. Pengembangan: teks biasa.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const json = (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';
const min = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;

/** Ringkas error: pakai penyebab asli (mis. error Postgres di balik DrizzleQueryError) dan batasi panjang. */
export function errInfo(e: unknown): Record<string, unknown> {
  if (e === undefined) return {};
  if (!(e instanceof Error)) return { error: String(e).slice(0, 500) };
  const cause = (e as { cause?: unknown }).cause;
  const root = cause instanceof Error ? cause : e;
  const query = cause instanceof Error && e.message.startsWith('Failed query:') ? e.message.split('\n')[0].slice(14, 200) : undefined;
  return {
    error: root.message.slice(0, 500), ...(query ? { query } : {}),
    ...((root as { code?: string }).code ? { code: (root as { code?: string }).code } : {}),
    stack: e.stack?.split('\n').filter((l) => l.includes('/src/')).slice(0, 4).map((l) => l.trim()).join(' | '),
  };
}

function write(level: Level, scope: string, msg: string, extra?: Record<string, unknown> | unknown) {
  if (ORDER[level] < min || process.env.LOG_SILENT === 'true') return;
  const data = extra instanceof Error || typeof extra !== 'object' || extra === null ? errInfo(extra) : (extra as Record<string, unknown>);
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (json) out.write(JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...data }) + '\n');
  else out.write(`[${scope}] ${level === 'info' ? '' : level.toUpperCase() + ' '}${msg}${Object.keys(data).length ? ' ' + JSON.stringify(data) : ''}\n`);
}

export const logger = {
  debug: (scope: string, msg: string, extra?: unknown) => write('debug', scope, msg, extra),
  info: (scope: string, msg: string, extra?: unknown) => write('info', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => write('warn', scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown) => write('error', scope, msg, extra),
};
