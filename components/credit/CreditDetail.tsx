import { Attachments } from '../files/Attachments';
import { IqalahRequestBox } from '../operations/Operations';
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Undo2, Send, FileSignature, PackageCheck, Ban, UserPlus, AlertTriangle, ShieldCheck, Printer } from 'lucide-react';
import { printContract } from '../../lib/print';
import { api, ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { AuthUser, CreditDetail as Detail, CreditSurvey } from '../../types';
import { Modal, ErrorBox, Spinner, formatDateTime, inputCls, labelCls, btnPrimary, btnSecondary } from '../superadmin/ui';
import { CreditBadge } from './CreditBadge';
import { DP_METHOD_LABEL, EVENT_LABEL, HANDOVER_LABEL, KYC_LABEL, MARITAL_LABEL, RESIDENCE_LABEL } from './labels';

type Tab = 'summary' | 'customer' | 'survey' | 'history' | 'schedule' | 'docs';
const TENORS = [3, 6, 12, 18, 24];

export const CreditDetailModal: React.FC<{ id: string; currentUser: AuthUser; onClose: () => void; onChanged: () => void }> = ({ id, currentUser, onClose, onChanged }) => {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aoTeam, setAoTeam] = useState<{ id: string; fullName: string; open: number }[]>([]);

  const load = useCallback(() => {
    api.get<Detail>(`/credit/applications/${id}`).then((r) => { setD(r); setError(null); }).catch((e) => setError((e as ApiError).message));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (currentUser.roleCode === 'branch-manager') api.get<{ team: { id: string; fullName: string; open: number }[] }>('/credit/ao-team').then((r) => setAoTeam(r.team)).catch(() => undefined);
  }, [currentUser.roleCode]);

  const run = async (path: string, body: unknown, method: 'post' | 'put' = 'post') => {
    setBusy(true); setError(null);
    try {
      const r = await (method === 'post' ? api.post<{ committeePending?: boolean }>(`/credit/applications/${id}/${path}`, body) : api.put<{ committeePending?: boolean }>(`/credit/applications/${id}/${path}`, body));
      load(); onChanged();
      return r;
    } catch (e) { setError((e as ApiError).message); return null; } finally { setBusy(false); }
  };

  if (!d) return <Modal title="Pengajuan Kredit" onClose={onClose} wide="xl">{error ? <ErrorBox message={error} /> : <Spinner />}</Modal>;
  const a = d.application;
  const cur = a.currency;
  const money = (v: number | null | undefined) => formatMoney(v, cur);
  const role = currentUser.roleCode;
  const isMyAo = role === 'ao' && a.aoId === currentUser.id;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'Ringkasan & Keputusan' }, { id: 'customer', label: 'Nasabah & KYC' }, { id: 'survey', label: 'Survei Lapangan' },
    { id: 'docs', label: 'Dokumen & Foto' }, { id: 'history', label: 'Riwayat' }, ...(d.installments.length ? [{ id: 'schedule' as Tab, label: 'Jadwal Angsuran' }] : []),
  ];

  return (
    <Modal wide="xl" onClose={onClose} title={<span className="flex items-center gap-3 flex-wrap"><span className="font-mono text-sm">{a.appNo}</span><CreditBadge status={a.status} />
      {a.requiresCommittee && <span className="text-xs text-orange-600 font-semibold">Perlu komite</span>}</span>}>
      <div className="space-y-4">
        <ErrorBox message={error} onClose={() => setError(null)} />
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <p><span className="text-slate-500">Nasabah</span> <strong className="text-slate-800 dark:text-white">{d.customer.fullName}</strong> <span className="text-slate-500">· {d.customer.phone}</span></p>
          <p><span className="text-slate-500">Produk</span> <strong className="text-slate-800 dark:text-white">{d.product.name}{a.qty > 1 ? ` × ${a.qty}` : ''}</strong> <span className="text-slate-500">· {money(a.cashPrice)}</span></p>
          <p><span className="text-slate-500">Cabang</span> <strong className="text-slate-800 dark:text-white">{d.branch.name}</strong> <span className="text-slate-500">· AO {d.ao?.fullName ?? '—'}</span></p>
        </div>
        {a.status === 'active' && ['branch-manager', 'branch-admin'].includes(role) && currentUser.branch?.id === a.branchId && (
          <div className="flex justify-end"><IqalahRequestBox applicationId={a.id} onDone={() => { load(); onChanged(); }} /></div>
        )}
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
          {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? 'border-masri-primary text-masri-primary' : 'border-transparent text-slate-500'}`}>{t.label}</button>)}
        </div>

        {tab === 'summary' && <SummaryTab d={d} money={money} currentUser={currentUser} isMyAo={isMyAo} aoTeam={aoTeam} busy={busy} run={run} goto={setTab} />}
        {tab === 'customer' && <CustomerTab d={d} editable={isMyAo && a.status === 'assigned'} busy={busy} run={run} money={money} />}
        {tab === 'survey' && <SurveyTab d={d} editable={isMyAo && a.status === 'assigned'} busy={busy} run={run} money={money} />}
        {tab === 'docs' && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Foto KTP, selfie, KK, bukti penghasilan & alamat, foto survei lapangan, dan akad bertanda tangan. Hanya dapat dilihat staf yang berwenang atas pengajuan ini.</p>
            <Attachments ownerType="credit" ownerId={a.id} kinds={['ktp', 'selfie', 'kk', 'income_proof', 'address_proof', 'survey', 'contract', 'other']}
              canUpload={['ao', 'branch-manager', 'branch-admin'].includes(role) && currentUser.branch?.id === a.branchId && !['rejected', 'cancelled'].includes(a.status)} title="Dokumen pengajuan" />
          </div>
        )}
        {tab === 'history' && (
          <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-4">
            {d.events.map((e) => (
              <li key={e.id} className="ml-4">
                <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-masri-primary ring-4 ring-white dark:ring-slate-800" />
                <p className="text-sm text-slate-700 dark:text-slate-200"><strong>{e.actorName}</strong> {EVENT_LABEL[e.type] ?? e.type}</p>
                {e.message && <p className="text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/40 rounded p-2 mt-1">{e.message}</p>}
                <p className="text-[11px] text-slate-400">{formatDateTime(e.createdAt)}</p>
              </li>
            ))}
          </ol>
        )}
        {tab === 'schedule' && (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 bg-slate-50 dark:bg-slate-900/50"><tr><th className="text-left px-3 py-2">Ke</th><th className="text-left px-3 py-2">Jatuh tempo</th><th className="text-right px-3 py-2">Angsuran</th><th className="text-right px-3 py-2">Dibayar</th><th className="text-left px-3 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {d.installments.map((i) => (
                <tr key={i.id}><td className="px-3 py-2">{i.seq}</td><td className="px-3 py-2">{i.dueDate}</td><td className="px-3 py-2 text-right">{money(i.amount)}</td>
                  <td className="px-3 py-2 text-right">{money(i.paidAmount)}</td><td className="px-3 py-2 text-xs">{i.status === 'paid' ? 'Lunas' : i.status === 'partial' ? 'Sebagian' : 'Terjadwal'}</td></tr>
              ))}
              <tr className="font-semibold"><td className="px-3 py-2" colSpan={2}>Total harga jual Murabahah</td><td className="px-3 py-2 text-right">{money(d.installments.reduce((s, i) => s + i.amount, 0))}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
type RunFn = (path: string, body: unknown, method?: 'post' | 'put') => Promise<{ committeePending?: boolean } | null>;

const Row: React.FC<{ k: string; v: React.ReactNode; strong?: boolean }> = ({ k, v, strong }) => (
  <div className={`flex justify-between gap-4 py-1.5 text-sm ${strong ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}><span className="text-slate-500 font-normal">{k}</span><span className="text-right">{v}</span></div>
);

const SummaryTab: React.FC<{ d: Detail; money: (v: number | null | undefined) => string; currentUser: AuthUser; isMyAo: boolean; aoTeam: { id: string; fullName: string; open: number }[]; busy: boolean; run: RunFn; goto: (t: Tab) => void }> = ({ d, money, currentUser, isMyAo, aoTeam, busy, run, goto }) => {
  const a = d.application;
  const role = currentUser.roleCode;
  const pv = d.analysis.preview;
  const final = a.tenor !== null;
  const [tenor, setTenor] = useState<number>(a.tenor ?? a.aoSuggestedTenor ?? a.requestedTenor);
  const [dpPct, setDpPct] = useState<number>(a.dpPct ?? a.aoSuggestedDpPct ?? a.requestedDpPct);
  const [notes, setNotes] = useState('');
  const [aoId, setAoId] = useState(a.aoId ?? '');
  const [hoMethod, setHoMethod] = useState('pickup');
  const [msg, setMsg] = useState<string | null>(null);
  const dsrBad = d.analysis.dsr !== null && d.analysis.dsr > d.analysis.maxDsr;
  const voted = d.votes.some((v) => v.userId === currentUser.id);

  const canAssign = role === 'branch-manager' && ['submitted', 'assigned'].includes(a.status);
  const canRecommend = isMyAo && a.status === 'assigned';
  const canBranchReview = role === 'branch-manager' && a.status === 'branch_review';
  const canDecide = role === 'biz-mgr' && a.status === 'hq_review' && !voted;
  const canContract = ['ao', 'branch-manager'].includes(role) && a.status === 'approved' && !a.contractNo && currentUser.branch?.id === a.branchId;
  const dpPending = a.status === 'approved' && !!a.contractNo && !!d.dpDue;
  const canReissueDp = dpPending && ['ao', 'branch-manager', 'cashier'].includes(role) && currentUser.branch?.id === a.branchId;
  const canHandover = role === 'branch-admin' && a.status === 'contracted';
  const canCancel = ['submitted', 'assigned', 'branch_review', 'hq_review', 'approved'].includes(a.status) && (role === 'branch-manager' || role === 'biz-mgr' || isMyAo);
  const termEditable = canRecommend || canDecide;

  const act = async (path: string, body: unknown) => {
    const r = await run(path, body);
    if (r) { setNotes(''); setMsg(r.committeePending ? 'Suara Anda tercatat. Menunggu persetujuan Business Manager kedua (komite).' : null); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">{final ? 'Syarat Murabahah (final)' : 'Simulasi Syarat'}</h4>
          {final ? (<>
            <Row k="Harga tunai" v={money(a.cashPrice)} />
            <Row k={`Uang muka (${a.dpPct}%)`} v={money(a.downPayment)} />
            <Row k="Pokok pembiayaan" v={money(a.financed)} />
            <Row k={`Margin tetap ${a.marginPct}%`} v={money(a.marginAmount)} />
            <Row k="Harga jual Murabahah" v={money(a.salePrice)} strong />
            <Row k={`Angsuran × ${a.tenor} bulan`} v={money(a.monthly)} strong />
            {a.fulfillBranchName && <Row k="Stok direservasi di" v={a.fulfillBranchName} />}
          </>) : pv ? (<>
            <Row k="Diminta nasabah" v={`${a.requestedTenor} bln · DP ${a.requestedDpPct}%`} />
            {a.aoSuggestedTenor && <Row k="Usulan AO" v={`${a.aoSuggestedTenor} bln · DP ${a.aoSuggestedDpPct}%`} />}
            <Row k="Pokok pembiayaan" v={money(pv.financed)} />
            <Row k={`Angsuran × ${pv.tenor} (margin ${pv.marginPct}%)`} v={money(pv.monthly)} strong />
            {pv.requiresCommittee && <p className="text-xs text-orange-600 mt-1">Melebihi batas wewenang Business Manager — perlu 2 suara komite.</p>}
          </>) : <p className="text-sm text-slate-500">Parameter tenor tidak lagi tersedia.</p>}
        </section>

        <section className={`p-4 rounded-xl border ${dsrBad ? 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'}`}>
          <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Analisa Kemampuan Bayar</h4>
          <Row k="Penghasilan (terverifikasi survei bila ada)" v={money(d.analysis.income)} />
          {d.survey && <Row k="Cicilan lain per bulan" v={money(d.survey.otherObligations)} />}
          <Row k={`Rasio angsuran / penghasilan (maks. ${d.analysis.maxDsr}%)`} v={<span className={dsrBad ? 'text-red-600 font-bold flex items-center gap-1' : 'text-green-700 font-bold'}>{dsrBad && <AlertTriangle className="w-4 h-4" />}{d.analysis.dsr ?? '—'}%</span>} />
          <Row k="KYC" v={a.kycCompletedAt ? <span className="text-green-700">Lengkap</span> : <button className="text-amber-600 underline" onClick={() => goto('customer')}>Belum lengkap</button>} />
          <Row k="Survei lapangan" v={d.survey ? <span className="text-green-700">Selesai · skor karakter {d.survey.characterScore}/5</span> : <button className="text-amber-600 underline" onClick={() => goto('survey')}>Belum ada</button>} />
        </section>

        {(a.aoNotes || a.mcNotes || a.decisionNotes || d.votes.length > 0 || a.closedReason) && (
          <section className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 space-y-2 text-sm">
            {a.aoNotes && <p><strong>AO ({a.aoRecommendation === 'approve' ? 'layak' : 'tidak layak'}):</strong> {a.aoNotes}</p>}
            {a.mcNotes && <p><strong>Manager Cabang:</strong> {a.mcNotes}</p>}
            {d.votes.map((v) => <p key={v.userId}><strong>{v.fullName} (BM):</strong> {v.decision === 'approve' ? 'setuju' : v.decision} — {v.notes}</p>)}
            {a.decisionNotes && <p><strong>Keputusan Pusat:</strong> {a.decisionNotes}</p>}
            {a.closedReason && <p className="text-red-600"><strong>Alasan:</strong> {a.closedReason}</p>}
          </section>
        )}
        {a.contractNo && (
          <section className="p-4 rounded-xl border border-emerald-300 dark:border-emerald-800 text-sm">
            <Row k="No. akad" v={<span className="font-mono">{a.contractNo}</span>} />
            <Row k="Ditandatangani" v={formatDateTime(a.contractSignedAt)} />
            <Row k="Uang muka" v={a.dpPaidAt ? `${money(a.dpPaidAmount)} diterima · ${DP_METHOD_LABEL[a.dpMethod ?? ''] ?? a.dpMethod}${a.dpRef ? ` · ${a.dpRef}` : ''}` : <span className="text-amber-700">Belum dibayar</span>} />
            {a.handoverAt && <Row k="Serah terima" v={`${formatDateTime(a.handoverAt)} · ${HANDOVER_LABEL[a.handoverMethod ?? ''] ?? a.handoverMethod}`} />}
            <button className={`${btnSecondary} mt-2`} onClick={() => printContract(`/credit/applications/${a.id}/contract-doc`).catch((e) => setMsg((e as Error).message))}><Printer className="w-4 h-4" />Cetak Akad</button>
          </section>
        )}
      </div>

      {/* Panel aksi sesuai role & tahap */}
      <div className="space-y-4">
        {msg && <p className="p-3 rounded-lg bg-amber-50 text-amber-800 text-sm">{msg}</p>}
        {canAssign && (
          <ActionBox title={a.status === 'submitted' ? 'Tugaskan Account Officer' : 'Alihkan ke AO lain'}>
            <select className={inputCls} value={aoId} onChange={(e) => setAoId(e.target.value)}>
              <option value="">— pilih AO —</option>
              {aoTeam.map((t) => <option key={t.id} value={t.id}>{t.fullName} ({t.open} pengajuan berjalan)</option>)}
            </select>
            <button className={btnPrimary} disabled={busy || !aoId} onClick={() => act('assign', { aoId })}><UserPlus className="w-4 h-4" /> Tugaskan</button>
          </ActionBox>
        )}

        {termEditable && (
          <ActionBox title={canRecommend ? 'Rekomendasi AO' : 'Keputusan Business Manager'}>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">Tenor
                <select className={inputCls} value={tenor} onChange={(e) => setTenor(Number(e.target.value))}>{TENORS.map((t) => <option key={t} value={t}>{t} bulan</option>)}</select></label>
              <label className="text-xs text-slate-500">Uang muka (%)
                <input type="number" min={0} max={90} className={inputCls} value={dpPct} onChange={(e) => setDpPct(Number(e.target.value))} /></label>
            </div>
            <textarea className={`${inputCls} h-20`} placeholder={canRecommend ? 'Analisa 5C: karakter, kapasitas, modal, jaminan, kondisi...' : 'Catatan keputusan'} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap gap-2 justify-end">
              {canRecommend ? (<>
                <button className={btnSecondary} disabled={busy} onClick={() => act('recommend', { recommendation: 'reject', tenor, dpPct, notes })}><XCircle className="w-4 h-4" /> Tidak Layak</button>
                <button className={btnPrimary} disabled={busy} onClick={() => act('recommend', { recommendation: 'approve', tenor, dpPct, notes })}><Send className="w-4 h-4" /> Layak — Kirim ke Manager</button>
              </>) : (<>
                <button className={btnSecondary} disabled={busy} onClick={() => act('decide', { decision: 'return', notes })}><Undo2 className="w-4 h-4" /> Kembalikan</button>
                <button className={btnSecondary} disabled={busy} onClick={() => act('decide', { decision: 'reject', notes })}><XCircle className="w-4 h-4" /> Tolak</button>
                <button className={btnPrimary} disabled={busy} onClick={() => act('decide', { decision: 'approve', notes, tenor, dpPct })}><CheckCircle2 className="w-4 h-4" /> Setujui</button>
              </>)}
            </div>
            {canDecide && <p className="text-[11px] text-slate-500">Persetujuan mereservasi stok di cabang (atau Gudang Pusat bila cabang kosong) dan mengunci syarat akad.</p>}
          </ActionBox>
        )}
        {role === 'biz-mgr' && a.status === 'hq_review' && voted && <p className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 text-sm text-slate-600">Anda sudah memberi suara. Menunggu Business Manager lain.</p>}

        {canBranchReview && (
          <ActionBox title="Review Manager Cabang">
            <textarea className={`${inputCls} h-20`} placeholder="Catatan untuk Pusat / AO" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap gap-2 justify-end">
              <button className={btnSecondary} disabled={busy} onClick={() => act('branch-review', { decision: 'return', notes })}><Undo2 className="w-4 h-4" /> Kembalikan ke AO</button>
              <button className={btnSecondary} disabled={busy} onClick={() => act('branch-review', { decision: 'reject', notes })}><XCircle className="w-4 h-4" /> Tolak</button>
              <button className={btnPrimary} disabled={busy} onClick={() => act('branch-review', { decision: 'forward', notes })}><Send className="w-4 h-4" /> Teruskan ke Pusat</button>
            </div>
          </ActionBox>
        )}

        {canContract && <ContractBox d={d} money={money} busy={busy} onSubmit={(body) => act('contract', body)} />}
        {dpPending && <DpPendingBox d={d} money={money} busy={busy} canReissue={canReissueDp} run={(path, body) => act(path, body)} />}

        {canHandover && (
          <ActionBox title="Serah Terima Manual (akad lama tanpa data pengiriman)">
            <p className="text-xs text-slate-500">Stok diambil dari {a.fulfillBranchName}. Setelah dicatat, jadwal angsuran aktif mulai bulan berikutnya.</p>
            <select className={inputCls} value={hoMethod} onChange={(e) => setHoMethod(e.target.value)}>{Object.entries(HANDOVER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input className={inputCls} placeholder="Catatan (nama penerima, kondisi barang...)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex justify-end"><button className={btnPrimary} disabled={busy} onClick={() => act('handover', { method: hoMethod, note: notes || null })}><PackageCheck className="w-4 h-4" /> Barang Diterima Nasabah</button></div>
          </ActionBox>
        )}

        {canCancel && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500 hover:text-red-600">Batalkan pengajuan</summary>
            <div className="mt-2 flex gap-2">
              <input className={inputCls} placeholder="Alasan pembatalan" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button className={btnSecondary} disabled={busy} onClick={() => act('cancel', { reason: notes })}><Ban className="w-4 h-4" /> Batalkan</button>
            </div>
          </details>
        )}
        {!canAssign && !termEditable && !canBranchReview && !canContract && !dpPending && !canHandover && (
          <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-sm text-slate-500">Tidak ada tindakan untuk Anda pada tahap ini.</p>
        )}
      </div>
    </div>
  );
};

const ActionBox: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="p-4 rounded-xl border border-masri-primary/40 bg-masri-light/40 dark:bg-emerald-900/10 space-y-3">
    <h4 className="font-bold text-masri-dark dark:text-emerald-200">{title}</h4>{children}
  </section>
);

const CustomerTab: React.FC<{ d: Detail; editable: boolean; busy: boolean; run: RunFn; money: (v: number | null | undefined) => string }> = ({ d, editable, busy, run, money }) => {
  const c = d.customer;
  const [check, setCheck] = useState<Record<string, { ok: boolean; note?: string }>>(d.application.kycChecklist ?? {});
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
        <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Data Nasabah · {c.customerNo}</h4>
        <Row k="Nama" v={c.fullName} /><Row k="NIK" v={<span className="font-mono">{c.nik}</span>} /><Row k="Tanggal lahir" v={c.birthDate} />
        <Row k="Status" v={`${MARITAL_LABEL[c.maritalStatus ?? ''] ?? '—'} · tanggungan ${c.dependents ?? 0}`} />
        <Row k="HP / Email" v={`${c.phone ?? '—'} · ${c.email ?? '—'}`} /><Row k="Alamat" v={`${c.address}, ${c.city}`} />
        <Row k="Pekerjaan" v={`${c.occupation ?? '—'}${c.employer ? ` · ${c.employer}` : ''}`} /><Row k="Penghasilan (diakui nasabah)" v={money(c.monthlyIncome)} />
        <Row k="Status KYC" v={c.kycStatus === 'verified' ? <span className="text-green-700 font-semibold">Terverifikasi</span> : c.kycStatus} />
        {d.application.purpose && <Row k="Tujuan" v={d.application.purpose} />}
      </section>
      <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
        <h4 className="text-xs font-bold uppercase text-slate-500">Checklist Verifikasi KYC (AO)</h4>
        {d.kycItems.map((k) => (
          <div key={k} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" disabled={!editable} checked={check[k]?.ok ?? false} onChange={(e) => setCheck({ ...check, [k]: { ...check[k], ok: e.target.checked } })} />
            <div className="flex-1">
              <p className="text-sm text-slate-700 dark:text-slate-200">{KYC_LABEL[k] ?? k}</p>
              {editable ? <input className={`${inputCls} mt-1 py-1 text-xs`} placeholder="Catatan" value={check[k]?.note ?? ''} onChange={(e) => setCheck({ ...check, [k]: { ok: check[k]?.ok ?? false, note: e.target.value } })} />
                : check[k]?.note && <p className="text-xs text-slate-500">{check[k]?.note}</p>}
            </div>
          </div>
        ))}
        {editable && <div className="flex justify-end"><button className={btnPrimary} disabled={busy} onClick={() => run('kyc', { checklist: check }, 'put')}>Simpan Verifikasi</button></div>}
        <p className="text-[11px] text-slate-400">Unggah dokumen & e-KYC (OCR KTP, liveness, Dukcapil) disiapkan sebagai integrasi berikutnya.</p>
      </section>
    </div>
  );
};

const emptySurvey: CreditSurvey = { visitedAt: '', addressVerified: false, residenceStatus: 'own', lengthOfStayYears: 0, incomeVerified: false, verifiedIncome: 0, otherObligations: 0, characterScore: 3, photos: [], notes: '' };

const SurveyTab: React.FC<{ d: Detail; editable: boolean; busy: boolean; run: RunFn; money: (v: number | null | undefined) => string }> = ({ d, editable, busy, run, money }) => {
  const [s, setS] = useState<CreditSurvey>(d.survey ? { ...d.survey, visitedAt: d.survey.visitedAt.slice(0, 16) } : { ...emptySurvey, verifiedIncome: d.customer.monthlyIncome ?? 0 });
  const [photoText, setPhotoText] = useState((d.survey?.photos ?? []).join('\n'));
  if (!editable && !d.survey) return <p className="text-sm text-slate-500 p-4">Survei lapangan belum dilakukan.</p>;
  const dis = !editable;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div><label className={labelCls}>Tanggal & jam kunjungan</label><input type="datetime-local" disabled={dis} className={inputCls} value={s.visitedAt} onChange={(e) => setS({ ...s, visitedAt: e.target.value })} /></div>
        <div><label className={labelCls}>Status tempat tinggal</label>
          <select disabled={dis} className={inputCls} value={s.residenceStatus} onChange={(e) => setS({ ...s, residenceStatus: e.target.value })}>{Object.entries(RESIDENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className={labelCls}>Lama tinggal (tahun)</label><input type="number" disabled={dis} className={inputCls} value={s.lengthOfStayYears} onChange={(e) => setS({ ...s, lengthOfStayYears: Number(e.target.value) })} /></div>
        <div><label className={labelCls}>Penghasilan terverifikasi / bulan</label><input type="number" disabled={dis} className={inputCls} value={s.verifiedIncome} onChange={(e) => setS({ ...s, verifiedIncome: Number(e.target.value) })} />
          <p className="text-xs text-slate-500 mt-1">Diakui nasabah: {money(d.customer.monthlyIncome)}</p></div>
        <div><label className={labelCls}>Cicilan lain / bulan</label><input type="number" disabled={dis} className={inputCls} value={s.otherObligations} onChange={(e) => setS({ ...s, otherObligations: Number(e.target.value) })} /></div>
        <div><label className={labelCls}>Skor karakter (1–5)</label><input type="number" min={1} max={5} disabled={dis} className={inputCls} value={s.characterScore} onChange={(e) => setS({ ...s, characterScore: Number(e.target.value) })} /></div>
      </div>
      <div className="flex flex-wrap gap-6 text-sm text-slate-700 dark:text-slate-300">
        <label className="flex items-center gap-2"><input type="checkbox" disabled={dis} checked={s.addressVerified} onChange={(e) => setS({ ...s, addressVerified: e.target.checked })} /> Alamat sesuai KTP / dokumen</label>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={dis} checked={s.incomeVerified} onChange={(e) => setS({ ...s, incomeVerified: e.target.checked })} /> Penghasilan terverifikasi (slip / tempat kerja / usaha)</label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label className={labelCls}>Catatan survei (lingkungan, tetangga, kondisi rumah)</label><textarea disabled={dis} className={`${inputCls} h-24`} value={s.notes ?? ''} onChange={(e) => setS({ ...s, notes: e.target.value })} /></div>
        <div><label className={labelCls}>URL foto survei (satu per baris)</label><textarea disabled={dis} className={`${inputCls} h-24 font-mono text-xs`} value={photoText} onChange={(e) => setPhotoText(e.target.value)} /></div>
      </div>
      {editable && <div className="flex justify-end"><button className={btnPrimary} disabled={busy || !s.visitedAt}
        onClick={() => run('survey', { ...s, visitedAt: new Date(s.visitedAt).toISOString(), photos: photoText.split('\n').map((x) => x.trim()).filter(Boolean), notes: s.notes || null }, 'put')}>Simpan Hasil Survei</button></div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Akad: uang muka + pilihan pengiriman (armada internal / kurir mitra / ambil sendiri)
// ---------------------------------------------------------------------------
interface DOpt { mode: 'internal' | 'partner' | 'pickup'; label: string; courierCode?: string; service?: string; etd: string; fee: number; note?: string }
const ContractBox: React.FC<{ d: Detail; money: (v: number | null | undefined) => string; busy: boolean; onSubmit: (body: unknown) => void }> = ({ d, money, busy, onSubmit }) => {
  const a = d.application;
  const [city, setCity] = useState(d.customer.city);
  const [address, setAddress] = useState(d.customer.address);
  const [postalCode, setPostalCode] = useState('');
  const [courierNote, setCourierNote] = useState<string | null>(null);
  const [opts, setOpts] = useState<DOpt[]>([]);
  const [from, setFrom] = useState<string>('');
  const [sel, setSel] = useState(0);
  const [channel, setChannel] = useState('cashier');
  const [bank, setBank] = useState('bca');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (city.trim().length < 2) return;
    const t = setTimeout(() => api.get<{ from: { name: string }; options: DOpt[]; courierNote: string | null }>(`/credit/applications/${a.id}/delivery-quote?city=${encodeURIComponent(city)}${/^[0-9A-Z]{4,8}$/i.test(postalCode) ? `&postalCode=${postalCode}` : ''}`)
      .then((r) => { setOpts(r.options); setFrom(r.from.name); setSel(0); setErr(null); setCourierNote(r.courierNote); }).catch((e) => setErr((e as ApiError).message)), 400);
    return () => clearTimeout(t);
  }, [city, postalCode, a.id]);
  const o = opts[sel];
  const due = (a.downPayment ?? 0) + (o?.fee ?? 0);
  return (
    <ActionBox title="Tandatangani Akad Murabahah">
      <p className="text-xs text-slate-500">Bacakan & tandatangani akad: harga jual {money(a.salePrice)}, angsuran tetap {money(a.monthly)} × {a.tenor} bulan. Stok di {a.fulfillBranchName}.
        Uang muka <strong>tidak diterima AO/Manager</strong> — sistem menerbitkan tagihan yang dibayar di Kasir atau online. Akad berlaku setelah uang muka lunas.</p>
      <div className="grid grid-cols-4 gap-2">
        <input className={inputCls} placeholder="Kota tujuan" value={city} onChange={(e) => setCity(e.target.value)} />
        <input className={inputCls} placeholder="Kode pos" maxLength={8} value={postalCode} onChange={(e) => setPostalCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))} />
        <input className={`${inputCls} col-span-2`} placeholder="Alamat pengiriman" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      {courierNote && <p className="text-xs text-amber-700">{courierNote}</p>}
      <ErrorBox message={err} />
      <div className="max-h-48 overflow-y-auto space-y-1">
        {opts.map((x, i) => (
          <label key={i} className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer ${sel === i ? 'border-masri-primary bg-white dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700'}`}>
            <input type="radio" checked={sel === i} onChange={() => setSel(i)} />
            <span className="flex-1">{x.label}<span className="block text-[11px] text-slate-500">{x.etd}{x.note ? ` · ${x.note}` : ''}</span></span>
            <span className="font-semibold">{x.fee ? money(x.fee) : 'Gratis'}</span>
          </label>
        ))}
        {opts.length === 0 && !err && <p className="text-xs text-slate-500">Isi kota tujuan untuk melihat pilihan pengiriman dari {from || 'lokasi stok'}.</p>}
      </div>
      <p className="text-sm">Tagihan uang muka: <strong>{money(due)}</strong> <span className="text-xs text-slate-500">(uang muka {money(a.downPayment)} + ongkir {money(o?.fee ?? 0)})</span></p>
      <div className="grid grid-cols-2 gap-2">
        <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="cashier">Dibayar di Kasir cabang (tunai / transfer)</option>
          <option value="va">Virtual Account (online)</option><option value="qris">QRIS (online)</option><option value="fpx">FPX (Malaysia)</option>
        </select>
        {channel === 'va' && <select className={inputCls} value={bank} onChange={(e) => setBank(e.target.value)}>{['bca', 'bni', 'bri', 'permata'].map((b) => <option key={b} value={b}>VA {b.toUpperCase()}</option>)}</select>}
      </div>
      <div className="flex justify-end"><button className={btnPrimary} disabled={busy || !o} onClick={() => onSubmit({
        dpChannel: channel, bank: channel === 'va' ? bank : null,
        delivery: { mode: o.mode, address, city, postalCode: postalCode || null, courierCode: o.courierCode ?? null, service: o.service ?? null },
      })}><FileSignature className="w-4 h-4" /> Tandatangani Akad & Terbitkan Tagihan</button></div>
    </ActionBox>
  );
};

/** Akad sudah ditandatangani, uang muka belum dibayar: tampilkan tagihan & opsi ganti metode. */
const DpPendingBox: React.FC<{ d: Detail; money: (v: number | null | undefined) => string; busy: boolean; canReissue: boolean; run: RunFn }> = ({ d, money, busy, canReissue, run }) => {
  const dp = d.dpDue!;
  const p = dp.payment;
  const [channel, setChannel] = useState('cashier');
  const [bank, setBank] = useState('bca');
  return (
    <ActionBox title="Menunggu Uang Muka">
      <p className="text-sm">Tagihan <strong>{money(dp.amount)}</strong> (uang muka {money(dp.downPayment)} + ongkir {money(dp.shippingFee ?? 0)}).</p>
      {p ? (
        <div className="text-xs p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <p className="font-mono">{p.paymentNo}</p>
          {p.channel === 'cashier' ? <p>Dibayar di Kasir cabang (menu Kasir → Terima Uang Muka).</p>
            : <p>{p.method.toUpperCase()}{p.bank ? ` ${p.bank.toUpperCase()}` : ''}{p.vaNumber ? `: ${p.vaNumber}` : ''}{p.payUrl ? ` · ${p.payUrl}` : ''}</p>}
          {p.expiresAt && <p className="text-slate-500">Berlaku sampai {formatDateTime(p.expiresAt)}</p>}
        </div>
      ) : <p className="text-xs text-amber-700">Tagihan sebelumnya kedaluwarsa — terbitkan ulang.</p>}
      {canReissue && (
        <div className="grid grid-cols-3 gap-2">
          <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="cashier">Kasir cabang</option><option value="va">Virtual Account</option><option value="qris">QRIS</option><option value="fpx">FPX</option></select>
          {channel === 'va' ? <select className={inputCls} value={bank} onChange={(e) => setBank(e.target.value)}>{['bca', 'bni', 'bri', 'permata'].map((b) => <option key={b} value={b}>{b.toUpperCase()}</option>)}</select> : <span />}
          <button className={btnSecondary} disabled={busy} onClick={() => run('dp-charge', { channel, bank: channel === 'va' ? bank : null })}>Terbitkan ulang tagihan</button>
        </div>
      )}
    </ActionBox>
  );
};
