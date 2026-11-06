import { useEffect, useState } from 'react';

/** Keranjang belanja tunai (disimpan di browser). */
export interface CartLine { productId: string; name: string; unitPrice: number; image?: string; qty: number }

const KEY = 'masri_cart_v1';
const listeners = new Set<() => void>();

function read(): CartLine[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as CartLine[]; } catch { return []; }
}
function write(lines: CartLine[]) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* storage penuh / diblokir */ }
  listeners.forEach((l) => l());
}

export const cart = {
  get: read,
  add(line: Omit<CartLine, 'qty'>, qty = 1) {
    const lines = read();
    const ex = lines.find((l) => l.productId === line.productId);
    if (ex) ex.qty = Math.min(20, ex.qty + qty); else lines.push({ ...line, qty });
    write(lines);
  },
  setQty(productId: string, qty: number) { write(read().map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, Math.min(20, qty)) } : l))); },
  remove(productId: string) { write(read().filter((l) => l.productId !== productId)); },
  clear() { write([]); },
  /** Kode promo dari banner / tautan kampanye, dipakai otomatis di checkout & pengajuan cicilan. */
  pendingPromo(): string | null { try { return sessionStorage.getItem('masri_promo'); } catch { return null; } },
  setPendingPromo(code: string | null) { try { if (code) sessionStorage.setItem('masri_promo', code); else sessionStorage.removeItem('masri_promo'); } catch { /* diblokir */ } },
};

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(read);
  useEffect(() => { const f = () => setLines(read()); listeners.add(f); window.addEventListener('storage', f); return () => { listeners.delete(f); window.removeEventListener('storage', f); }; }, []);
  return lines;
}
