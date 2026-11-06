// Isi Syarat & Ketentuan dan Kebijakan Privasi (ID / MS / EN), disesuaikan negara layanan.
// PENTING: draf ini disusun dari cara kerja aplikasi. Wajib ditinjau konsultan hukum & Dewan Pengawas
// Syariah sebelum go-live (lihat docs/KEPATUHAN.md). Naikkan LEGAL_VERSION setiap kali isi berubah
// (harus sama dengan server/src/config/legal.ts) agar persetujuan baru tercatat dengan versi yang benar.
import type { Country, Lang } from './i18n';

export const LEGAL_VERSION = '2026-10';

export interface LegalCompany { legalName: string; address: string; privacyEmail: string; supportWhatsapp: string; brand: string }
export type Block = string | { list: string[] };
export interface LegalSectionData { title: string; body: Block[] }
export interface LegalDoc { title: string; subtitle: string; updated: string; sections: LegalSectionData[] }

const LAW: Record<Country, Record<Lang, { pdp: string; law: string; forum: string; consumer: string }>> = {
  ID: {
    id: { pdp: 'Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP)', law: 'hukum Republik Indonesia', forum: 'musyawarah, dan bila tidak tercapai melalui Badan Arbitrase Syariah Nasional (BASYARNAS) atau Pengadilan Agama sesuai ketentuan yang berlaku', consumer: 'Undang-Undang Perlindungan Konsumen' },
    ms: { pdp: 'Undang-Undang No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (Indonesia)', law: 'undang-undang Republik Indonesia', forum: 'musyawarah, dan jika gagal melalui BASYARNAS atau Pengadilan Agama', consumer: 'undang-undang perlindungan pengguna Indonesia' },
    en: { pdp: 'Indonesian Law No. 27 of 2022 on Personal Data Protection (PDP Law)', law: 'the laws of the Republic of Indonesia', forum: 'amicable deliberation (musyawarah), failing which through the National Sharia Arbitration Board (BASYARNAS) or the Religious Court as applicable', consumer: 'Indonesian consumer protection law' },
  },
  MY: {
    id: { pdp: 'Personal Data Protection Act 2010 (Malaysia) beserta perubahannya', law: 'undang-undang Malaysia', forum: 'musyawarah, dan bila tidak tercapai melalui mediasi/arbitrase syariah atau pengadilan yang berwenang di Malaysia', consumer: 'Consumer Protection Act 1999 (Malaysia)' },
    ms: { pdp: 'Akta Perlindungan Data Peribadi 2010 (Malaysia) berserta pindaannya', law: 'undang-undang Malaysia', forum: 'rundingan secara baik, dan jika gagal melalui pengantaraan/timbang tara syariah atau mahkamah yang berbidang kuasa di Malaysia', consumer: 'Akta Pelindungan Pengguna 1999' },
    en: { pdp: 'the Personal Data Protection Act 2010 (Malaysia), as amended', law: 'the laws of Malaysia', forum: 'amicable negotiation, failing which through Shariah mediation/arbitration or the competent courts of Malaysia', consumer: 'the Consumer Protection Act 1999 (Malaysia)' },
  },
  BN: {
    id: { pdp: 'peraturan perlindungan data pribadi Brunei Darussalam yang berlaku', law: 'hukum Brunei Darussalam', forum: 'musyawarah, dan bila tidak tercapai melalui pengadilan yang berwenang di Brunei Darussalam', consumer: 'peraturan perlindungan konsumen Brunei Darussalam' },
    ms: { pdp: 'perintah perlindungan data peribadi Brunei Darussalam yang berkuat kuasa', law: 'undang-undang Negara Brunei Darussalam', forum: 'rundingan secara baik, dan jika gagal melalui mahkamah yang berbidang kuasa di Negara Brunei Darussalam', consumer: 'Perintah Perlindungan Pengguna (Perdagangan Saksama) 2011' },
    en: { pdp: 'the personal data protection order of Brunei Darussalam in force', law: 'the laws of Brunei Darussalam', forum: 'amicable negotiation, failing which through the competent courts of Brunei Darussalam', consumer: 'the Consumer Protection (Fair Trading) Order 2011' },
  },
};

const fill = (c: LegalCompany, l: Lang) => ({
  name: c.legalName || (l === 'en' ? `${c.brand} (registered business name to be completed)` : l === 'ms' ? `${c.brand} (nama berdaftar akan dilengkapkan)` : `${c.brand} (nama badan usaha akan dilengkapi)`),
  addr: c.address ? `, ${c.address}` : '',
  mail: c.privacyEmail || (l === 'en' ? 'our Helpdesk' : l === 'ms' ? 'Meja Bantuan kami' : 'Helpdesk kami'),
  wa: c.supportWhatsapp || '—',
});

// ---------------------------------------------------------------- SYARAT & KETENTUAN
export function termsDoc(lang: Lang, country: Country, c: LegalCompany): LegalDoc {
  const L = LAW[country][lang], f = fill(c, lang);
  if (lang === 'en') return {
    title: 'Terms & Conditions', subtitle: 'The rules for buying and financing through Masri-M. Please read them before you transact.', updated: `Version ${LEGAL_VERSION}`,
    sections: [
      { title: 'About us & these terms', body: [`The Masri-M platform (website and related services) is operated by ${f.name}${f.addr} ("Masri-M", "we"). By placing an order, submitting a financing application, or signing in to My Account, you agree to these Terms and to our Privacy Policy.`] },
      { title: 'Eligibility', body: ['You must be at least 18 years old (or of legal age in your country) and hold a valid identity document. Financing applications require accurate identity, employment and income information; providing false information may lead to rejection or cancellation and may be reported to the authorities.'] },
      { title: 'Cash purchases', body: [{ list: [
        'Prices shown include applicable tax unless stated otherwise. Shipping and installation fees are shown before you confirm.',
        'Orders must be paid within the time limit shown at checkout (24 hours by default); unpaid orders are cancelled automatically.',
        'Online payments are processed by licensed payment providers. Transfer the exact amount shown so that your payment is matched automatically.',
        'Goods may be delivered by our own fleet, by a partner courier, or collected at a branch using the pickup code sent to you. Uncollected goods are held for the period stated in your pickup notice.',
      ] }] },
      { title: 'Murabahah instalment financing', body: [
        'Financing uses a Murabahah (sale) contract: Masri-M owns the goods first, then sells them to you at the cost price plus a profit margin that is disclosed and agreed at the outset. The selling price and monthly instalment are fixed for the whole tenor; there is no interest (riba).',
        { list: [
          'Prices and instalments shown on the website are simulations. The final terms are those stated in the Murabahah contract you sign after verification and approval.',
          'Approval is at Masri-M\'s discretion following identity verification (KYC), a field survey, and an affordability assessment.',
          'Instalments start after you receive the goods (handover), unless your contract states otherwise.',
          'Late payment: after the grace period stated in your contract, a fixed late charge (ta\'zir) may apply. Ta\'zir is NOT Masri-M income; it is channelled entirely to charity (Dana Kebajikan) and recorded separately.',
          'Early settlement: you may settle early at any time. Masri-M grants a rebate (ibra\') on the unearned margin at the rate stated in your contract.',
          'Ownership and risk pass to you on handover in accordance with the contract. Goods under financing may not be sold or pledged before full settlement without our written consent.',
        ] },
      ] },
      { title: 'Cancellations, returns & warranty', body: [{ list: [
        'Orders not yet shipped may be cancelled; payments already received are refunded to the original method or a nominated account.',
        'Goods that arrive damaged, incomplete or not as described must be reported within 2×24 hours of receipt via Helpdesk, with photos.',
        'Manufacturer warranty claims are handled through Helpdesk or the nearest branch. For financed goods, remedies are replacement or repair; cancellation of a signed contract after handover follows the terms of that contract.',
      ] }] },
      { title: 'Your account & security', body: ['Sign-in to My Account uses a one-time code sent to your WhatsApp. Never share this code — Masri-M staff will never ask for it. You are responsible for activity carried out with codes sent to your number. Notify us immediately if your number changes or is misused.'] },
      { title: 'Prohibited use', body: ['You may not use the platform for money laundering, terrorist financing, fictitious purchases to obtain cash, fraud, or any attempt to disrupt, scrape or gain unauthorised access to our systems.'] },
      { title: 'Liability', body: [`We are not liable for losses caused by events beyond our reasonable control (force majeure), including disruption of banking, payment or courier networks. Nothing in these Terms limits your rights under ${L.consumer}.`] },
      { title: 'Governing law & disputes', body: [`These Terms are governed by ${L.law}. Disputes shall be resolved by ${L.forum}. Contact Helpdesk first — most issues can be resolved quickly.`] },
      { title: 'Changes & contact', body: [`We may update these Terms; the version and date are shown at the top. Material changes will be announced on the website. Contact: WhatsApp ${f.wa}, email ${f.mail}.`] },
    ],
  };
  if (lang === 'ms') return {
    title: 'Terma & Syarat', subtitle: 'Peraturan pembelian dan pembiayaan melalui Masri-M. Sila baca sebelum berurusan.', updated: `Versi ${LEGAL_VERSION}`,
    sections: [
      { title: 'Tentang kami & terma ini', body: [`Platform Masri-M (laman web dan perkhidmatan berkaitan) dikendalikan oleh ${f.name}${f.addr} ("Masri-M", "kami"). Dengan membuat pesanan, menghantar permohonan pembiayaan atau log masuk ke Akaun Saya, anda bersetuju dengan Terma ini dan Dasar Privasi kami.`] },
      { title: 'Kelayakan', body: ['Anda mestilah berumur sekurang-kurangnya 18 tahun (atau umur dewasa di negara anda) dan memiliki dokumen pengenalan yang sah. Permohonan pembiayaan memerlukan maklumat identiti, pekerjaan dan pendapatan yang tepat; maklumat palsu boleh menyebabkan permohonan ditolak atau dibatalkan dan boleh dilaporkan kepada pihak berkuasa.'] },
      { title: 'Pembelian tunai', body: [{ list: [
        'Harga yang dipaparkan termasuk cukai yang berkenaan kecuali dinyatakan sebaliknya. Kos penghantaran dan pemasangan dipaparkan sebelum anda mengesahkan pesanan.',
        'Pesanan mesti dibayar dalam had masa yang dipaparkan semasa checkout (24 jam secara lalai); pesanan yang tidak dibayar dibatalkan secara automatik.',
        'Bayaran dalam talian diproses oleh penyedia pembayaran berlesen. Bayar jumlah yang tepat supaya bayaran dipadankan secara automatik.',
        'Barang boleh dihantar oleh armada kami, kurier rakan kongsi, atau diambil di cawangan dengan kod pengambilan yang dihantar kepada anda.',
      ] }] },
      { title: 'Pembiayaan ansuran Murabahah', body: [
        'Pembiayaan menggunakan akad Murabahah (jual beli): Masri-M memiliki barang terlebih dahulu, kemudian menjualnya kepada anda pada harga kos ditambah margin keuntungan yang dinyatakan dan dipersetujui dari awal. Harga jualan dan ansuran bulanan adalah tetap sepanjang tempoh; tiada faedah (riba).',
        { list: [
          'Harga dan ansuran di laman web adalah simulasi. Terma muktamad adalah seperti dalam akad Murabahah yang anda tandatangani selepas pengesahan dan kelulusan.',
          'Kelulusan tertakluk kepada budi bicara Masri-M selepas pengesahan identiti (KYC), tinjauan lapangan dan penilaian kemampuan.',
          'Ansuran bermula selepas anda menerima barang (serahan), kecuali dinyatakan lain dalam akad.',
          'Lewat bayar: selepas tempoh tangguh dalam akad, caj lewat tetap (ta\'zir) boleh dikenakan. Ta\'zir BUKAN pendapatan Masri-M; ia disalurkan sepenuhnya kepada dana kebajikan dan direkodkan berasingan.',
          'Penyelesaian awal: anda boleh menyelesaikan pada bila-bila masa dan berhak mendapat rebat (ibra\') atas margin yang belum diperoleh mengikut kadar dalam akad.',
          'Barang yang dibiayai tidak boleh dijual atau dicagarkan sebelum penyelesaian penuh tanpa kebenaran bertulis kami.',
        ] },
      ] },
      { title: 'Pembatalan, pemulangan & waranti', body: [{ list: [
        'Pesanan yang belum dihantar boleh dibatalkan; bayaran yang telah diterima akan dipulangkan.',
        'Barang yang rosak, tidak lengkap atau tidak seperti diterangkan mesti dilaporkan dalam 2×24 jam selepas diterima melalui Meja Bantuan, berserta gambar.',
        'Tuntutan waranti pengeluar diuruskan melalui Meja Bantuan atau cawangan terdekat. Bagi barang yang dibiayai, remedi ialah penggantian atau pembaikan; pembatalan akad selepas serahan tertakluk kepada terma akad.',
      ] }] },
      { title: 'Akaun & keselamatan', body: ['Log masuk ke Akaun Saya menggunakan kod sekali guna yang dihantar ke WhatsApp anda. Jangan kongsi kod ini — kakitangan Masri-M tidak akan memintanya. Maklumkan kami segera jika nombor anda berubah atau disalah guna.'] },
      { title: 'Penggunaan yang dilarang', body: ['Platform tidak boleh digunakan untuk pengubahan wang haram, pembiayaan keganasan, pembelian fiktif untuk mendapatkan wang tunai, penipuan, atau sebarang cubaan mengganggu atau menceroboh sistem kami.'] },
      { title: 'Liabiliti', body: [`Kami tidak bertanggungjawab atas kerugian akibat peristiwa di luar kawalan munasabah kami (force majeure). Tiada apa-apa dalam Terma ini mengehadkan hak anda di bawah ${L.consumer}.`] },
      { title: 'Undang-undang & pertikaian', body: [`Terma ini ditadbir oleh ${L.law}. Pertikaian diselesaikan melalui ${L.forum}. Hubungi Meja Bantuan terlebih dahulu.`] },
      { title: 'Perubahan & hubungan', body: [`Kami boleh mengemas kini Terma ini; versi dipaparkan di bahagian atas. Hubungi: WhatsApp ${f.wa}, e-mel ${f.mail}.`] },
    ],
  };
  return {
    title: 'Syarat & Ketentuan', subtitle: 'Aturan belanja dan pembiayaan di Masri-M. Mohon dibaca sebelum bertransaksi.', updated: `Versi ${LEGAL_VERSION}`,
    sections: [
      { title: 'Tentang kami & ketentuan ini', body: [`Platform Masri-M (website dan layanan terkait) dikelola oleh ${f.name}${f.addr} ("Masri-M", "kami"). Dengan membuat pesanan, mengirim pengajuan pembiayaan, atau masuk ke Akun Saya, Anda menyetujui Syarat & Ketentuan ini dan Kebijakan Privasi kami.`] },
      { title: 'Kelayakan', body: ['Anda wajib berusia minimal 18 tahun (atau sudah dewasa menurut hukum negara Anda) dan memiliki kartu identitas yang sah. Pengajuan pembiayaan memerlukan data identitas, pekerjaan, dan penghasilan yang benar; data palsu dapat menyebabkan pengajuan ditolak atau dibatalkan dan dapat dilaporkan kepada pihak berwenang.'] },
      { title: 'Pembelian tunai', body: [{ list: [
        'Harga yang tercantum sudah termasuk pajak yang berlaku kecuali dinyatakan lain. Ongkos kirim dan biaya pemasangan ditampilkan sebelum Anda mengonfirmasi pesanan.',
        'Pesanan wajib dibayar dalam batas waktu yang ditampilkan saat checkout (standar 24 jam); pesanan yang tidak dibayar batal otomatis.',
        'Pembayaran online diproses oleh penyedia jasa pembayaran berizin. Transfer sesuai nominal persis agar pembayaran tercocokkan otomatis.',
        'Barang dapat dikirim dengan armada Masri-M, kurir mitra, atau diambil sendiri di cabang dengan kode pengambilan yang dikirim kepada Anda. Barang yang tidak diambil disimpan sesuai batas waktu pada pemberitahuan pengambilan.',
      ] }] },
      { title: 'Pembiayaan cicilan Murabahah', body: [
        'Pembiayaan menggunakan akad Murabahah (jual beli): Masri-M memiliki barang terlebih dahulu, lalu menjualnya kepada Anda dengan harga pokok ditambah margin keuntungan yang disebutkan terbuka dan disepakati di awal. Harga jual dan angsuran per bulan tetap sampai lunas; tidak ada bunga (riba).',
        { list: [
          'Harga dan angsuran di website adalah simulasi. Ketentuan final adalah yang tercantum dalam akad Murabahah yang Anda tandatangani setelah verifikasi dan persetujuan.',
          'Persetujuan merupakan kewenangan Masri-M setelah verifikasi identitas (KYC), survei lapangan, dan analisis kemampuan bayar.',
          'Angsuran dimulai setelah barang Anda terima (serah terima), kecuali akad menyatakan lain.',
          'Keterlambatan: setelah masa tenggang yang tercantum dalam akad, dapat dikenakan sanksi tetap (ta\'zir). Ta\'zir BUKAN pendapatan Masri-M; seluruhnya disalurkan sebagai Dana Kebajikan (sosial) dan dicatat terpisah.',
          'Pelunasan dipercepat: Anda dapat melunasi kapan saja dan mendapat potongan (ibra\') atas margin yang belum jatuh tempo sesuai besaran dalam akad.',
          'Kepemilikan dan risiko barang beralih kepada Anda saat serah terima sesuai akad. Barang yang masih dibiayai tidak boleh dijual atau dijaminkan sebelum lunas tanpa persetujuan tertulis kami.',
        ] },
      ] },
      { title: 'Pembatalan, retur & garansi', body: [{ list: [
        'Pesanan yang belum dikirim dapat dibatalkan; dana yang sudah diterima dikembalikan ke metode asal atau rekening yang Anda tunjuk.',
        'Barang yang tiba rusak, tidak lengkap, atau tidak sesuai wajib dilaporkan paling lambat 2×24 jam setelah diterima melalui Helpdesk, disertai foto.',
        'Klaim garansi pabrikan dilayani melalui Helpdesk atau cabang terdekat. Untuk barang yang dibiayai, penyelesaiannya berupa penggantian atau perbaikan; pembatalan akad setelah serah terima mengikuti ketentuan akad.',
      ] }] },
      { title: 'Akun & keamanan', body: ['Masuk ke Akun Saya menggunakan kode sekali pakai yang dikirim ke WhatsApp Anda. Jangan berikan kode ini kepada siapa pun — petugas Masri-M tidak pernah memintanya. Aktivitas dengan kode yang dikirim ke nomor Anda menjadi tanggung jawab Anda. Segera hubungi kami bila nomor Anda berganti atau disalahgunakan.'] },
      { title: 'Larangan', body: ['Platform tidak boleh digunakan untuk pencucian uang, pendanaan terorisme, pembelian fiktif untuk memperoleh uang tunai (gestun), penipuan, maupun upaya mengganggu, menyalin data secara otomatis, atau mengakses sistem kami tanpa izin.'] },
      { title: 'Tanggung jawab', body: [`Kami tidak bertanggung jawab atas kerugian akibat keadaan di luar kendali wajar kami (force majeure), termasuk gangguan jaringan perbankan, pembayaran, atau kurir. Ketentuan ini tidak mengurangi hak Anda menurut ${L.consumer}.`] },
      { title: 'Hukum yang berlaku & penyelesaian sengketa', body: [`Ketentuan ini tunduk pada ${L.law}. Sengketa diselesaikan secara ${L.forum}. Silakan hubungi Helpdesk terlebih dahulu — sebagian besar kendala dapat diselesaikan dengan cepat.`] },
      { title: 'Perubahan & kontak', body: [`Kami dapat memperbarui ketentuan ini; versi tercantum di bagian atas. Perubahan penting diumumkan di website. Kontak: WhatsApp ${f.wa}, email ${f.mail}.`] },
    ],
  };
}

// ---------------------------------------------------------------- KEBIJAKAN PRIVASI
export function privacyDoc(lang: Lang, country: Country, c: LegalCompany): LegalDoc {
  const L = LAW[country][lang], f = fill(c, lang);
  if (lang === 'en') return {
    title: 'Privacy Policy', subtitle: 'What personal data we collect, why, who we share it with, and your rights.', updated: `Version ${LEGAL_VERSION}`,
    sections: [
      { title: 'Who is responsible', body: [`${f.name}${f.addr}, is the controller of your personal data and processes it in accordance with ${L.pdp}. Privacy requests: ${f.mail}.`] },
      { title: 'Data we collect', body: [{ list: [
        'Identity: full name, identity number, date of birth, marital status, number of dependants, and a photo of your identity document (for financing).',
        'Contact & delivery: phone/WhatsApp number, email, address, city, postcode.',
        'Financial: occupation, employer, monthly income, field-survey results, financing contracts, instalment and payment history.',
        'Transactions: orders, deliveries, returns, receipts, and conversations with Helpdesk or the Virtual Assistant.',
        'Technical: IP address, device/browser information and activity logs needed for security and fraud prevention.',
      ] }] },
      { title: 'Why we use it (purpose & legal basis)', body: [{ list: [
        'To process orders, payments and deliveries (performance of a contract).',
        'To assess and administer Murabahah financing, including KYC and affordability checks (your consent and performance of a contract).',
        'To send transaction notices, OTP codes and instalment reminders via WhatsApp/email (performance of a contract).',
        'To comply with accounting, tax, anti-money-laundering and other legal obligations (legal obligation).',
        'To keep the platform secure and prevent fraud (legitimate interest).',
      ] }, 'We do not sell your personal data and do not use it for third-party advertising.'] },
      { title: 'Who we share it with', body: ['Only with service providers that help us run the service, under confidentiality obligations and only as needed:', { list: [
        'Payment providers (e.g. Midtrans, Billplz) and banks — to process payments.',
        'Courier partners and logistics aggregators (e.g. Biteship, EasyParcel) — name, phone and address for delivery.',
        'Messaging providers (WhatsApp gateway, email) — to deliver notifications and sign-in codes.',
        'Cloud hosting and storage providers — to run our systems.',
        'AI provider for the Virtual Assistant (Anthropic) — only the messages you type to the assistant. Do not enter identity numbers or other sensitive data in the chat.',
        'Authorities, where required by law.',
      ] }] },
      { title: 'International transfers', body: ['Some providers (such as the AI assistant provider) may process data outside your country. We only use providers that apply adequate data-protection safeguards, as required by applicable law.'] },
      { title: 'How long we keep it', body: ['We keep personal data only as long as needed for the purposes above. Financing contracts, payment and accounting records are kept for the period required by accounting and tax law (generally up to 10 years). Data from applications that do not proceed is deleted or anonymised once it is no longer needed.'] },
      { title: 'Security', body: ['Data is transmitted over encrypted connections (HTTPS). Staff access is role-based, protected by strong passwords and logged in an audit trail. Identity documents are stored in private storage that is not publicly accessible. No system is completely secure; we will notify you and the authorities of a personal data breach as required by law.'] },
      { title: 'Your rights', body: [{ list: [
        'Access and obtain a copy of your data — use "Download my data" in My Account → Profile.',
        'Correct inaccurate data — through My Account or Helpdesk (verified names require a branch visit).',
        'Withdraw consent or request deletion — through My Account or by email. Data we must keep by law (e.g. active financing, accounting records) is retained until the obligation ends.',
        'Object to or restrict processing, and lodge a complaint with the data-protection authority in your country.',
      ] }, 'We respond to requests within the time required by law (in Indonesia, generally 3×24 hours to acknowledge).'] },
      { title: 'Cookies & local storage', body: ['We use only essential cookies (sign-in session) and browser storage for your language, country and cart. We do not use advertising or third-party tracking cookies.'] },
      { title: 'Changes', body: ['We will post updates here with a new version number and, for material changes, ask for your consent again where required.'] },
    ],
  };
  if (lang === 'ms') return {
    title: 'Dasar Privasi', subtitle: 'Data peribadi yang kami kumpul, sebabnya, dengan siapa dikongsi, dan hak anda.', updated: `Versi ${LEGAL_VERSION}`,
    sections: [
      { title: 'Pihak yang bertanggungjawab', body: [`${f.name}${f.addr}, ialah pengawal data peribadi anda dan memprosesnya selaras dengan ${L.pdp}. Permintaan privasi: ${f.mail}.`] },
      { title: 'Data yang kami kumpul', body: [{ list: [
        'Identiti: nama penuh, nombor pengenalan, tarikh lahir, status perkahwinan, bilangan tanggungan dan gambar dokumen pengenalan (untuk pembiayaan).',
        'Hubungan & penghantaran: nombor telefon/WhatsApp, e-mel, alamat, bandar, poskod.',
        'Kewangan: pekerjaan, majikan, pendapatan bulanan, hasil tinjauan lapangan, akad pembiayaan, sejarah ansuran dan bayaran.',
        'Transaksi: pesanan, penghantaran, pemulangan, resit, serta perbualan dengan Meja Bantuan atau Pembantu Maya.',
        'Teknikal: alamat IP, maklumat peranti/pelayar dan log aktiviti untuk keselamatan dan pencegahan penipuan.',
      ] }] },
      { title: 'Tujuan penggunaan', body: [{ list: [
        'Memproses pesanan, bayaran dan penghantaran.',
        'Menilai dan mentadbir pembiayaan Murabahah, termasuk KYC dan penilaian kemampuan (dengan persetujuan anda).',
        'Menghantar notis transaksi, kod log masuk dan peringatan ansuran melalui WhatsApp/e-mel.',
        'Mematuhi kewajipan perakaunan, cukai, pencegahan pengubahan wang haram dan undang-undang lain.',
        'Menjaga keselamatan platform dan mencegah penipuan.',
      ] }, 'Kami tidak menjual data peribadi anda dan tidak menggunakannya untuk pengiklanan pihak ketiga.'] },
      { title: 'Pihak yang menerima data', body: ['Hanya penyedia perkhidmatan yang membantu operasi kami, di bawah kewajipan kerahsiaan dan setakat yang perlu:', { list: [
        'Penyedia pembayaran (cth. Midtrans, Billplz) dan bank.',
        'Kurier dan agregator logistik (cth. Biteship, EasyParcel) — nama, telefon dan alamat penghantaran.',
        'Penyedia pesanan (gerbang WhatsApp, e-mel).',
        'Penyedia pengehosan dan storan awan.',
        'Penyedia AI bagi Pembantu Maya (Anthropic) — hanya mesej yang anda taip. Jangan masukkan nombor pengenalan atau data sensitif dalam sembang.',
        'Pihak berkuasa, jika dikehendaki undang-undang.',
      ] }] },
      { title: 'Pemindahan ke luar negara', body: ['Sesetengah penyedia (seperti penyedia AI) mungkin memproses data di luar negara anda. Kami hanya menggunakan penyedia yang menyediakan perlindungan data yang memadai seperti dikehendaki undang-undang.'] },
      { title: 'Tempoh penyimpanan', body: ['Data disimpan selama diperlukan untuk tujuan di atas. Akad, rekod bayaran dan perakaunan disimpan mengikut tempoh yang dikehendaki undang-undang perakaunan dan cukai. Data permohonan yang tidak diteruskan dipadam atau dianonimkan apabila tidak lagi diperlukan.'] },
      { title: 'Keselamatan', body: ['Data dihantar melalui sambungan tersulit (HTTPS). Akses kakitangan berasaskan peranan, dilindungi kata laluan kukuh dan direkodkan dalam log audit. Dokumen pengenalan disimpan dalam storan persendirian. Kami akan memaklumkan anda dan pihak berkuasa sekiranya berlaku pelanggaran data seperti dikehendaki undang-undang.'] },
      { title: 'Hak anda', body: [{ list: [
        'Mengakses dan mendapatkan salinan data — gunakan "Muat turun data saya" di Akaun Saya → Profil.',
        'Membetulkan data yang tidak tepat.',
        'Menarik balik persetujuan atau meminta pemadaman — data yang wajib disimpan mengikut undang-undang dikekalkan sehingga kewajipan tamat.',
        'Membuat aduan kepada pihak berkuasa perlindungan data di negara anda.',
      ] }] },
      { title: 'Kuki & storan pelayar', body: ['Kami hanya menggunakan kuki penting (sesi log masuk) dan storan pelayar untuk bahasa, negara dan troli anda. Tiada kuki pengiklanan atau penjejakan pihak ketiga.'] },
      { title: 'Perubahan', body: ['Kemas kini akan disiarkan di sini dengan nombor versi baharu.'] },
    ],
  };
  return {
    title: 'Kebijakan Privasi', subtitle: 'Data pribadi apa yang kami kumpulkan, untuk apa, dibagikan kepada siapa, dan apa saja hak Anda.', updated: `Versi ${LEGAL_VERSION}`,
    sections: [
      { title: 'Pengendali data', body: [`${f.name}${f.addr}, adalah pengendali data pribadi Anda dan memprosesnya sesuai ${L.pdp}. Permintaan terkait data pribadi: ${f.mail}.`] },
      { title: 'Data yang kami kumpulkan', body: [{ list: [
        'Identitas: nama lengkap, NIK/nomor identitas, tanggal lahir, status perkawinan, jumlah tanggungan, dan foto kartu identitas (untuk pembiayaan).',
        'Kontak & pengiriman: nomor HP/WhatsApp, email, alamat, kota, kode pos.',
        'Keuangan: pekerjaan, tempat kerja, penghasilan bulanan, hasil survei lapangan, akad pembiayaan, riwayat angsuran dan pembayaran.',
        'Transaksi: pesanan, pengiriman, retur, kuitansi, serta percakapan dengan Helpdesk atau Asisten Virtual.',
        'Teknis: alamat IP, informasi perangkat/peramban, dan log aktivitas untuk keamanan dan pencegahan penipuan.',
      ] }] },
      { title: 'Tujuan & dasar pemrosesan', body: [{ list: [
        'Memproses pesanan, pembayaran, dan pengiriman (pelaksanaan perjanjian).',
        'Menilai dan mengelola pembiayaan Murabahah, termasuk verifikasi KYC dan analisis kemampuan bayar (persetujuan Anda dan pelaksanaan perjanjian).',
        'Mengirim pemberitahuan transaksi, kode masuk, dan pengingat angsuran via WhatsApp/email (pelaksanaan perjanjian).',
        'Memenuhi kewajiban akuntansi, perpajakan, anti pencucian uang, dan kewajiban hukum lainnya (kewajiban hukum).',
        'Menjaga keamanan platform dan mencegah penipuan (kepentingan yang sah).',
      ] }, 'Kami tidak menjual data pribadi Anda dan tidak menggunakannya untuk iklan pihak ketiga.'] },
      { title: 'Pihak yang menerima data', body: ['Hanya penyedia layanan yang membantu operasional kami, dengan kewajiban kerahasiaan dan sebatas yang diperlukan:', { list: [
        'Penyedia jasa pembayaran (mis. Midtrans, Billplz) dan bank — untuk memproses pembayaran.',
        'Kurir mitra dan agregator logistik (mis. Biteship, EasyParcel) — nama, nomor HP, dan alamat pengiriman.',
        'Penyedia layanan pesan (gateway WhatsApp, email) — untuk mengirim pemberitahuan dan kode masuk.',
        'Penyedia server dan penyimpanan — untuk menjalankan sistem kami.',
        'Penyedia AI untuk Asisten Virtual (Anthropic) — hanya pesan yang Anda ketik ke asisten. Jangan menuliskan NIK atau data sensitif lain di percakapan.',
        'Instansi berwenang, bila diwajibkan oleh hukum.',
      ] }] },
      { title: 'Transfer ke luar negeri', body: ['Sebagian penyedia (seperti penyedia AI) dapat memproses data di luar negara Anda. Kami hanya bekerja sama dengan penyedia yang menerapkan pelindungan data yang setara atau memadai sesuai ketentuan hukum yang berlaku.'] },
      { title: 'Masa penyimpanan', body: ['Data disimpan selama diperlukan untuk tujuan di atas. Akad, catatan pembayaran, dan dokumen akuntansi disimpan selama masa yang diwajibkan peraturan akuntansi dan perpajakan (umumnya hingga 10 tahun). Data pengajuan yang tidak berlanjut dihapus atau dianonimkan setelah tidak diperlukan lagi.'] },
      { title: 'Keamanan', body: ['Data dikirim melalui koneksi terenkripsi (HTTPS). Akses petugas dibatasi sesuai peran, dilindungi password kuat, dan tercatat di log audit. Foto identitas disimpan di penyimpanan privat yang tidak dapat diakses publik. Tidak ada sistem yang sepenuhnya aman; bila terjadi kegagalan pelindungan data, kami akan memberi tahu Anda dan instansi terkait sesuai ketentuan hukum.'] },
      { title: 'Hak Anda', body: [{ list: [
        'Mengakses dan memperoleh salinan data — gunakan "Unduh data saya" di Akun Saya → Profil.',
        'Memperbaiki data yang tidak akurat — melalui Akun Saya atau Helpdesk (nama yang sudah terverifikasi diubah melalui cabang).',
        'Menarik persetujuan atau meminta penghapusan — melalui Akun Saya atau email. Data yang wajib disimpan menurut hukum (mis. pembiayaan yang masih berjalan, dokumen akuntansi) tetap disimpan sampai kewajiban tersebut berakhir.',
        'Mengajukan keberatan atau pembatasan pemrosesan, serta menyampaikan pengaduan kepada otoritas pelindungan data.',
      ] }, 'Kami menanggapi permintaan dalam batas waktu yang ditetapkan peraturan (umumnya 3×24 jam).'] },
      { title: 'Cookie & penyimpanan peramban', body: ['Kami hanya memakai cookie yang diperlukan (sesi masuk) dan penyimpanan peramban untuk bahasa, negara, dan keranjang Anda. Kami tidak memakai cookie iklan atau pelacak pihak ketiga.'] },
      { title: 'Perubahan kebijakan', body: ['Pembaruan akan diumumkan di halaman ini dengan nomor versi baru; untuk perubahan penting, kami akan meminta persetujuan ulang bila diwajibkan.'] },
    ],
  };
}
