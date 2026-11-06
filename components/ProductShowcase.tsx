import React, { useEffect, useState } from 'react';
import { CatalogGrid } from './catalog/CatalogGrid';
import { ProductDetailModal } from './catalog/ProductDetailModal';
import { ApplyPrefill } from './credit/ApplyForm';
import { btnPrimary, btnSecondary } from './superadmin/ui';
import { cart } from '../lib/cart';
import { useLocale } from '../lib/i18n';

/** Katalog pilihan di halaman depan, diambil dari backend. */
export const ProductShowcase: React.FC<{ onApply?: (p: ApplyPrefill) => void; onCheckout?: () => void }> = ({ onApply, onCheckout }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [ok, setOk] = useState(true);
  const { t } = useLocale();
  // Banner beranda yang mengarah ke produk tertentu
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) setOpenId(id); };
    window.addEventListener('masri:open-product', h);
    return () => window.removeEventListener('masri:open-product', h);
  }, []);
  return (
    <section id="catalog" className="py-20 bg-slate-50 dark:bg-slate-900 scroll-mt-28 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <h2 className="text-3xl md:text-4xl font-bold text-masri-dark dark:text-white mb-2">{t('catalog.title')}</h2>
          <p className="text-slate-600 dark:text-slate-400">{t('catalog.lead')}</p>
        </div>
        <CatalogGrid limit={8} onOpen={setOpenId} onLoaded={setOk} />
        {!ok && <p className="text-center text-sm text-slate-500 mt-4">{t('catalog.error')}</p>}
      </div>
      {openId && <ProductDetailModal productId={openId} onClose={() => setOpenId(null)} action={onApply ? (p, o) => (
        <div className="grid grid-cols-2 gap-2">
          <button className={`${btnSecondary} justify-center py-3`} disabled={!p.inStock} onClick={() => { cart.add({ productId: p.id, name: p.name, unitPrice: p.cashPrice, image: p.images[0] }); setOpenId(null); onCheckout?.(); }}>
            {t('catalog.buyCash')}
          </button>
          <button className={`${btnPrimary} justify-center py-3`} onClick={() => { setOpenId(null); onApply({ productId: p.id, tenor: o?.tenor, dpPct: o ? Math.round((o.downPayment / p.cashPrice) * 100) : undefined }); }}>
            {t('catalog.applyThis')}
          </button>
        </div>
      ) : undefined} />}
    </section>
  );
};
