import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, FileText, Loader2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { formatDateTime } from '../superadmin/ui';

export interface Attachment { id: string; kind: string; filename: string; contentType: string; size: number; createdAt: string; uploadedByName: string | null; url: string }
type OwnerType = 'credit' | 'shipment' | 'expense' | 'return';

export const KIND_LABEL: Record<string, string> = {
  ktp: 'KTP', selfie: 'Selfie + KTP', kk: 'Kartu Keluarga', income_proof: 'Bukti penghasilan', address_proof: 'Bukti alamat', survey: 'Foto survei',
  contract: 'Akad bertanda tangan', pod: 'Bukti terima', receipt: 'Nota / faktur', photo: 'Foto barang', other: 'Lainnya',
};

/** Perkecil foto besar sebelum diunggah (hemat kuota di lapangan). PDF dikirim apa adanya. */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900_000) return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.85));
}

export async function uploadFile(ownerType: OwnerType, ownerId: string, kind: string, file: File): Promise<Attachment> {
  const body = await shrink(file);
  const qs = new URLSearchParams({ ownerType, ownerId, kind, filename: file.name });
  const r = await fetch(`/api/files?${qs}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Unggah gagal (${r.status})`);
  return j.file;
}

/** Daftar lampiran + tombol unggah per jenis. */
export const Attachments: React.FC<{ ownerType: OwnerType; ownerId: string; kinds: string[]; canUpload: boolean; title?: string; compact?: boolean }> = ({ ownerType, ownerId, kinds, canUpload, title = 'Lampiran', compact }) => {
  const [list, setList] = useState<Attachment[] | null>(null);
  const [kind, setKind] = useState(kinds[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => { api.get<{ files: Attachment[] }>(`/files?ownerType=${ownerType}&ownerId=${ownerId}`).then((r) => setList(r.files)).catch((e) => setError((e as ApiError).message)); }, [ownerType, ownerId]);
  useEffect(load, [load]);
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs: File[] = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!fs.length) return;
    setBusy(true); setError(null);
    try { for (const f of fs) await uploadFile(ownerType, ownerId, kind, f); load(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const has = (k: string) => list?.some((f) => f.kind === k);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{title}</p>
        {!compact && kinds.length > 1 && <div className="flex flex-wrap gap-1">{kinds.map((k) => <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded ${has(k) ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700'}`}>{has(k) ? '✓ ' : ''}{KIND_LABEL[k] ?? k}</span>)}</div>}
        {canUpload && (
          <div className="flex items-center gap-1 ml-auto">
            {kinds.length > 1 && <select className="text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded px-1 py-1" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select>}
            <button type="button" className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-masri-primary/40 text-masri-primary hover:bg-masri-primary hover:text-white disabled:opacity-50" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}Unggah</button>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture={kind === 'pod' || kind === 'survey' ? 'environment' : undefined} multiple className="hidden" onChange={onPick} />
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {list && list.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {list.map((f) => (
            <button type="button" key={f.id} onClick={() => setPreview(f)} title={`${KIND_LABEL[f.kind] ?? f.kind} · ${f.filename} · ${formatDateTime(f.createdAt)}${f.uploadedByName ? ` · ${f.uploadedByName}` : ''}`}
              className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
              {f.contentType.startsWith('image/') ? <img src={f.url} alt={f.filename} className="w-full h-full object-cover" loading="lazy" /> : <FileText className="w-8 h-8 text-slate-400" />}
              <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[9px] px-1 truncate">{KIND_LABEL[f.kind] ?? f.kind}</span>
            </button>
          ))}
        </div>
      ) : list && <p className="text-xs text-slate-400">Belum ada lampiran.</p>}
      {preview && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white" aria-label="Tutup"><X className="w-6 h-6" /></button>
          {preview.contentType.startsWith('image/') ? <img src={preview.url} alt={preview.filename} className="max-w-full max-h-full rounded" onClick={(e) => e.stopPropagation()} />
            : <iframe src={preview.url} title={preview.filename} className="w-full max-w-3xl h-[85vh] bg-white rounded" onClick={(e) => e.stopPropagation()} />}
        </div>
      )}
    </div>
  );
};
