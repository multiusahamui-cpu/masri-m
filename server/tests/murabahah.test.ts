import { describe, expect, test } from 'vitest';
import { simulate } from '../src/lib/murabahah.js';
import { sniffType } from '../src/lib/storage.js';
import { sameArea } from '../src/lib/couriers.js';

describe('simulasi Murabahah', () => {
  const margins = { '6': 8, '12': 15 };
  test('harga jual = pokok + margin flat, dibulatkan ke atas Rp100', () => {
    const [six, twelve] = simulate(5_500_000, margins, 10, 'IDR');
    expect(six.downPayment).toBe(550_000);
    expect(six.financed).toBe(4_950_000);
    expect(six.marginAmount).toBe(396_000);
    expect(six.salePrice).toBe(5_346_000);
    expect(twelve.monthly % 100).toBe(0);
    expect(twelve.monthly * 12).toBeGreaterThanOrEqual(twelve.salePrice);
  });
  test('uang muka tidak boleh di bawah minimum', () => {
    const [o] = simulate(1_000_000, { '3': 5 }, 20, 'IDR', 5);
    expect(o.downPayment).toBe(200_000);
  });
});

describe('utilitas', () => {
  test('deteksi tipe file dari isi', () => {
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffType(Buffer.from('<html>'))).toBeNull();
  });
  test('kecocokan kota', () => {
    expect(sameArea('Jakarta', 'Kota Jakarta Timur')).toBe(true);
    expect(sameArea('Bandung', 'Payakumbuh')).toBe(false);
  });
});
