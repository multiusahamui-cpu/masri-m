import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Send, Loader2, Bot, ShoppingCart, FileSignature, PackageSearch, Ticket, MessageCircle, RotateCcw } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { cart } from '../lib/cart';
import { formatMoney } from '../lib/format';
import { t, useLocale } from '../lib/i18n';

interface ProductCard { id: string; name: string; brand: string; image: string | null; cashPrice: number; currency: string; inStock: boolean; monthlyFrom: number | null; tenorFrom: number | null }
type Action =
  | { type: 'track_order'; orderNo: string; phone: string }
  | { type: 'track_credit'; appNo: string; phone: string }
  | { type: 'ticket'; ticketNo: string }
  | { type: 'apply_credit'; productId: string };
interface Msg { role: 'user' | 'assistant'; content: string; products?: ProductCard[]; actions?: Action[]; isError?: boolean }

interface Props {
  onApply: (prefill: { productId: string }) => void;
  onCheckout: () => void;
  onTrackOrder: (orderNo: string, phone?: string) => void;
  onTrackCredit: (appNo: string, phone?: string) => void;
}

const WELCOME = () => t('va.welcome');
const SUGGESTIONS = () => [1, 2, 3, 4, 5].map((i) => t(`va.s${i}`));

/** Markdown minimal: **tebal**, daftar "- ", baris baru. */
function RichText({ text }: { text: string }) {
  const inline = (s: string, k: number) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : <React.Fragment key={`${k}-${i}`}>{part}</React.Fragment>);
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`ul${blocks.length}`} className="list-disc pl-5 space-y-0.5">{list.map((l, i) => <li key={i}>{inline(l, i)}</li>)}</ul>); list = []; } };
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) { list.push(m[1]); return; }
    flush();
    if (line.trim()) blocks.push(<p key={`p${i}`}>{inline(line, i)}</p>);
  });
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

export const VirtualAssistant: React.FC<Props> = ({ onApply, onCheckout, onTrackOrder, onTrackCredit }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<{ enabled: boolean; whatsapp: string | null } | null>(null);
  const L = useLocale();
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', content: WELCOME() }]);
  // Ganti bahasa sebelum percakapan dimulai: sapaan ikut berganti
  useEffect(() => { setMessages((m) => (m.length === 1 ? [{ role: 'assistant', content: WELCOME() }] : m)); }, [L.lang]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ enabled: boolean; whatsapp: string | null }>(`/assistant/status?country=${L.country}`).then(setStatus).catch(() => setStatus({ enabled: false, whatsapp: null }));
  }, [L.country]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isOpen, loading]);
  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 50); }, [isOpen]);

  const waLink = status?.whatsapp ? `https://wa.me/${status.whatsapp.replace(/[^0-9]/g, '')}` : null;

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    setInput('');
    const history = [...messages, { role: 'user' as const, content }];
    setMessages(history);
    setLoading(true);
    try {
      const r = await api.post<{ reply: string; products: ProductCard[]; actions: Action[] }>('/assistant/chat', {
        country: L.country, lang: L.lang, messages: history.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: r.reply, products: r.products, actions: r.actions }]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t('va.offlineErr');
      setMessages((prev) => [...prev, { role: 'assistant', content: msg, isError: true }]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => setMessages([{ role: 'assistant', content: WELCOME() }]);
  const actionBtn = 'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border border-masri-primary/30 text-masri-primary dark:text-green-300 dark:border-green-700 hover:bg-masri-primary hover:text-white transition-colors';

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 w-[calc(100vw-3rem)] max-w-[420px] h-[min(600px,calc(100vh-7rem))] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-700">
          <div className="bg-masri-primary p-4 flex justify-between items-center text-white">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 p-1.5 rounded-full"><Bot className="w-4 h-4" /></div>
              <div>
                <h3 className="font-bold text-sm">{t('va.title')}</h3>
                <p className="text-xs text-green-100 flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${status?.enabled ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`}></span>
                  {status?.enabled ? t('va.online') : t('va.offline')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 1 && <button onClick={reset} title={t('va.newChat')} className="hover:bg-black/10 p-1 rounded"><RotateCcw className="w-4 h-4" /></button>}
              <button onClick={() => setIsOpen(false)} className="hover:bg-black/10 p-1 rounded" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
            </div>
          </div>

          {status && !status.enabled ? (
            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-4 text-sm text-slate-600 dark:text-slate-300">
              <Bot className="w-10 h-10 text-slate-300" />
              <p>{t('va.disabled')}</p>
              {waLink && <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-full font-medium hover:bg-green-700"><MessageCircle className="w-4 h-4" />WhatsApp CS</a>}
              <div className="flex gap-2 flex-wrap justify-center">
                <button className={actionBtn} onClick={() => { setIsOpen(false); onTrackCredit(''); }}><FileSignature className="w-3.5 h-3.5" />{t('cta.track')}</button>
                <button className={actionBtn} onClick={() => { setIsOpen(false); onTrackOrder(''); }}><PackageSearch className="w-3.5 h-3.5" />{t('track.title')}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 bg-slate-50 dark:bg-slate-900 space-y-4">
                {messages.map((m, idx) => (
                  <div key={idx} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[88%] p-3 rounded-lg text-sm shadow-sm ${m.role === 'user'
                      ? 'bg-masri-primary text-white rounded-br-none whitespace-pre-wrap'
                      : m.isError ? 'bg-red-50 text-red-700 border border-red-100 rounded-bl-none dark:bg-red-900/30 dark:text-red-200 dark:border-red-800'
                        : 'bg-white text-slate-700 border border-gray-100 rounded-bl-none dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'}`}>
                      {m.role === 'user' ? m.content : <RichText text={m.content} />}
                    </div>

                    {!!m.products?.length && (
                      <div className="mt-2 w-[88%] space-y-2">
                        {m.products.map((p) => (
                          <div key={p.id} className="flex gap-3 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-lg p-2 shadow-sm">
                            {p.image && <img src={p.image} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{p.name}</p>
                              <p className="text-xs text-slate-500">{formatMoney(p.cashPrice, p.currency)}{p.monthlyFrom ? ` · mulai ${formatMoney(p.monthlyFrom, p.currency)}/bln (${p.tenorFrom}x)` : ''}</p>
                              {!p.inStock && <p className="text-xs text-amber-600">{t('product.outStock')}</p>}
                              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                <button className={actionBtn} disabled={!p.inStock} onClick={() => { cart.add({ productId: p.id, name: p.name, unitPrice: p.cashPrice, image: p.image ?? undefined }); setIsOpen(false); onCheckout(); }}>
                                  <ShoppingCart className="w-3.5 h-3.5" />{t('catalog.buyCash')}
                                </button>
                                <button className={actionBtn} onClick={() => { setIsOpen(false); onApply({ productId: p.id }); }}>
                                  <FileSignature className="w-3.5 h-3.5" />{t('catalog.applyThis')}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!!m.actions?.filter((a) => a.type !== 'apply_credit').length && (
                      <div className="mt-2 flex gap-1.5 flex-wrap">
                        {m.actions.map((a, i) => a.type === 'track_order' ? (
                          <button key={i} className={actionBtn} onClick={() => { setIsOpen(false); onTrackOrder(a.orderNo, a.phone); }}><PackageSearch className="w-3.5 h-3.5" />{t('va.openTrack')} {a.orderNo}</button>
                        ) : a.type === 'track_credit' ? (
                          <button key={i} className={actionBtn} onClick={() => { setIsOpen(false); onTrackCredit(a.appNo, a.phone); }}><FileSignature className="w-3.5 h-3.5" />{t('va.openStatus')} {a.appNo}</button>
                        ) : a.type === 'ticket' ? (
                          <span key={i} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800"><Ticket className="w-3.5 h-3.5" />{t('va.ticket')} {a.ticketNo}</span>
                        ) : null)}
                      </div>
                    )}
                  </div>
                ))}

                {messages.length === 1 && !loading && (
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS().map((s) => <button key={s} className={actionBtn} onClick={() => send(s)}>{s}</button>)}
                  </div>
                )}

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-slate-800 p-3 rounded-lg rounded-bl-none shadow-sm border border-gray-100 dark:border-slate-700 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-masri-primary" />
                      <span className="text-xs text-gray-500">{t('va.thinking')}</span>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <div className="p-3 bg-white dark:bg-slate-800 border-t border-gray-100 dark:border-slate-700">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    maxLength={1500}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(input); }}
                    placeholder={t('va.placeholder')}
                    className="flex-1 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-900 rounded-full px-4 py-2 focus:outline-none focus:border-masri-primary"
                  />
                  <button onClick={() => send(input)} disabled={loading || !input.trim()} aria-label={t('common.send')}
                    className="bg-masri-gold text-white p-2 rounded-full hover:bg-amber-600 transition-colors disabled:opacity-50">
                    <Send className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                  {t('va.disclaimer')}
                  {waLink && <> · <a href={waLink} target="_blank" rel="noreferrer" className="underline">WhatsApp CS</a></>}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`${isOpen ? 'scale-0' : 'scale-100'} transition-transform duration-200 bg-masri-primary hover:bg-masri-dark text-white p-4 rounded-full shadow-lg flex items-center gap-2 group border-2 border-white`}
      >
        <MessageSquare className="w-6 h-6" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 whitespace-nowrap font-medium pl-0 group-hover:pl-2">{t('va.ask')}</span>
      </button>
    </div>
  );
};
