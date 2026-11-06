/** Format angka uang sesuai mata uang (default Rupiah). */
export const formatMoney = (v: number | null | undefined, currency = 'IDR', locale = 'id-ID') =>
  v === null || v === undefined ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: currency === 'IDR' ? 0 : 2 }).format(v);

export const formatNumber = (v: number) => new Intl.NumberFormat('id-ID').format(v);
