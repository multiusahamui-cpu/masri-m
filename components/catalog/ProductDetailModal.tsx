import React, { useEffect, useState } from 'react';
import { ShieldCheck, Truck, Wrench, ImageOff } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { InstallmentOption } from '../../types';
import { Modal, ErrorBox, Spinner } from '../superadmin/ui';
import { useLocale } from '../../lib/i18n';

interface Detail {
  country: { currency: string; locale: string };
  product: { id: string; name: string; brand: string; description: string; specs: string[]; images: string[]; warrantyMonths: number;
    isBulky: boolean; requiresInstallation: boolean; categoryName: string; cashPrice: number; inStock: boolean };
  minDownPaymentPct: number;
  installments: InstallmentOption[];
}

/** Detail produk + simulasi cicilan Murabahah (uang muka bisa digeser). */
export const ProductDetailModal: React.FC<{ productId: string; onClose: () => void; action?: (p: Detail['product'], o: InstallmentOption | null) => React.ReactNode }> = ({ productId, onClose, action }) => {
  const [d, setD] = useState<Detail | null>(null);
  const [dp, setDp] = useState<number | null>(null);
  const [tenor, setTenor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, country, money: fmtMoney } = useLocale();

  useEffect(() => {
    const t = setTimeout(() => {
      api.get<Detail>(`/catalog/products/${productId}?country=${country}${dp !== null ? `&dpPct=${dp}` : ''}`)
        .then((r) => { setD(r); if (dp === null) setDp(r.minDownPaymentPct); if (tenor === null) setTenor(r.installments[Math.floor(r.installments.length / 2)]?.tenor ?? null); })
        .catch((e) => setError((e as ApiError).message));
    }, dp === null ? 0 : 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, dp, country]);

  const money = (v: number) => fmtMoney(v, d?.country.currency);
  const chosen = d?.installments.find((o) => o.tenor === tenor) ?? null;

  return (
    <Modal title={d?.product.name ?? t('product.detail')} onClose={onClose} wide="xl">
      <ErrorBox message={error} />
      {!d ? <Spinner /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="aspect-[4/3] rounded-xl bg-slate-100 dark:bg-slate-700 overflow-hidden flex items-center justify-center">
              {d.product.images[0] ? <img src={d.product.images[0]} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover" /> : <ImageOff className="w-10 h-10 text-slate-400" />}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {d.product.warrantyMonths > 0 && <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 flex items-center gap-1 text-slate-600 dark:text-slate-300"><ShieldCheck className="w-3.5 h-3.5" /> {t('product.warranty', { n: d.product.warrantyMonths })}</span>}
              {d.product.isBulky && <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 flex items-center gap-1 text-slate-600 dark:text-slate-300"><Truck className="w-3.5 h-3.5" /> {t('product.cargo')}</span>}
              {d.product.requiresInstallation && <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 flex items-center gap-1 text-slate-600 dark:text-slate-300"><Wrench className="w-3.5 h-3.5" /> {t('product.install')}</span>}
              <span className={`px-2 py-1 rounded font-semibold ${d.product.inStock ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{d.product.inStock ? t('product.inStock') : t('product.outStock')}</span>
            </div>
            <ul className="text-sm text-slate-700 dark:text-slate-300 list-disc pl-5 space-y-1">{d.product.specs.map((s) => <li key={s}>{s}</li>)}</ul>
            {d.product.description && <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{d.product.description}</p>}
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500">{d.product.brand} · {d.product.categoryName}</p>
              <p className="text-sm text-slate-500 mt-2">{t('product.cashPrice')}</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{money(d.product.cashPrice)}</p>
            </div>

            <div className="p-4 rounded-xl bg-masri-light dark:bg-emerald-900/20 border border-masri-primary/30 space-y-3">
              <p className="font-bold text-masri-dark dark:text-emerald-200">{t('product.sim')}</p>
              <label className="block text-sm text-slate-700 dark:text-slate-300">
                {t('product.dp')}: <strong>{dp}%</strong> ({money(d.installments[0]?.downPayment ?? 0)})
                <input type="range" min={d.minDownPaymentPct} max={50} step={5} value={dp ?? d.minDownPaymentPct} onChange={(e) => setDp(Number(e.target.value))} className="w-full accent-emerald-700" />
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {d.installments.map((o) => (
                  <button key={o.tenor} onClick={() => setTenor(o.tenor)}
                    className={`px-1 py-2 rounded-lg border text-center min-w-0 ${tenor === o.tenor ? 'bg-masri-primary text-white border-masri-primary' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
                    <p className="text-xs">{o.tenor} {t('product.mo')}</p>
                    <p className="text-xs font-bold truncate" title={money(o.monthly)}>{money(o.monthly).replace(/^(Rp|RM|B?\$|BND)\s?/, '')}</p>
                  </button>
                ))}
              </div>
              {chosen && (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-masri-primary/10">
                    <tr><td className="py-1 text-slate-600 dark:text-slate-300">{t('product.cashPrice')}</td><td className="py-1 text-right">{money(d.product.cashPrice)}</td></tr>
                    <tr><td className="py-1 text-slate-600 dark:text-slate-300">{t('product.dp')}</td><td className="py-1 text-right">− {money(chosen.downPayment)}</td></tr>
                    <tr><td className="py-1 text-slate-600 dark:text-slate-300">{t('product.financed')}</td><td className="py-1 text-right">{money(chosen.financed)}</td></tr>
                    <tr><td className="py-1 text-slate-600 dark:text-slate-300">{t('product.margin', { pct: chosen.marginPct })}</td><td className="py-1 text-right">+ {money(chosen.marginAmount)}</td></tr>
                    <tr className="font-semibold"><td className="py-1">{t('product.salePrice')}</td><td className="py-1 text-right">{money(chosen.salePrice)}</td></tr>
                    <tr className="font-bold text-masri-dark dark:text-emerald-200"><td className="py-1">{t('product.monthly')} × {chosen.tenor}</td><td className="py-1 text-right">{money(chosen.monthly)}</td></tr>
                  </tbody>
                </table>
              )}
              <p className="text-[11px] text-slate-500">{t('product.note')}</p>
            </div>
            {action?.(d.product, chosen)}
          </div>
        </div>
      )}
    </Modal>
  );
};
