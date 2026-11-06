/**
 * Perhitungan Murabahah (jual-beli dengan margin tetap yang disepakati di awal).
 *   pokok pembiayaan = harga tunai - uang muka
 *   harga jual (akad) = pokok x (1 + margin%)
 *   angsuran          = harga jual / tenor   (dibulatkan ke atas sesuai pembulatan mata uang)
 * Margin bersifat flat untuk seluruh tenor akad, bukan bunga majemuk.
 */
export interface InstallmentOption {
  tenor: number;          // bulan
  marginPct: number;      // % total akad
  downPayment: number;
  financed: number;       // pokok pembiayaan
  marginAmount: number;
  salePrice: number;      // harga jual Murabahah (pokok + margin)
  monthly: number;
  totalPayable: number;   // DP + seluruh angsuran
}

const ROUND_UNIT: Record<string, number> = { IDR: 100, MYR: 0.05, BND: 0.05 };

function roundUp(v: number, currency: string) {
  const unit = ROUND_UNIT[currency] ?? 0.01;
  return Math.round(Math.ceil(v / unit - 1e-9) * unit * 100) / 100;
}

export function simulate(cashPrice: number, marginByTenor: Record<string, number>, minDpPct: number, currency: string, dpPct = minDpPct): InstallmentOption[] {
  const dp = roundUp((cashPrice * Math.max(dpPct, minDpPct)) / 100, currency);
  const financed = Math.max(0, cashPrice - dp);
  return Object.entries(marginByTenor)
    .map(([t, m]) => ({ tenor: Number(t), marginPct: Number(m) }))
    .filter((o) => o.tenor > 0)
    .sort((a, b) => a.tenor - b.tenor)
    .map(({ tenor, marginPct }) => {
      const marginAmount = roundUp((financed * marginPct) / 100, currency);
      const salePrice = financed + marginAmount;
      const monthly = roundUp(salePrice / tenor, currency);
      return { tenor, marginPct, downPayment: dp, financed, marginAmount, salePrice, monthly, totalPayable: dp + monthly * tenor };
    });
}
