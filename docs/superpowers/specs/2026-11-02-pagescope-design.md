# PageScope — Design Spec

- **Tanggal:** 2026-11-02
- **Status:** Disetujui oleh pemilik proyek melalui sesi brainstorming (4 seksi desain)
- **Repo:** `https://github.com/devalfian/website-auditor` (saat spec ditulis: kosong, belum ada commit)
- **Bahasa dokumen:** Indonesia (dokumen kerja internal). Dokumentasi publik (`README`, `CONTRIBUTING`, `docs/rules/*`) akan berbahasa Inggris karena target audiensinya developer open source internasional.

---

## 1. Ringkasan

**PageScope** adalah auditor kualitas website open source yang memeriksa kebenaran teknis dan SEO sebuah halaman dalam hitungan detik **tanpa browser**, lalu menghasilkan finding berbasis bukti beserta snippet sumber dan patch perbaikan. Disediakan sebagai **library, CLI, dan quality gate untuk CI**.

### Positioning (satu kalimat)

> PageScope memeriksa kebenaran teknis & SEO sebuah halaman dalam hitungan detik tanpa browser, lalu memberi Anda snippet dan patch untuk memperbaikinya — sebagai library, CLI, dan quality gate di CI.

Kalimat ini memuat tiga pembeda yang bisa diuji:

1. **Tanpa browser** — pembeda utama terhadap Lighthouse CI (butuh Chrome di runner) dan Unlighthouse.
2. **Snippet + patch** — pembeda terhadap tool yang hanya melaporkan "title kosong" tanpa lokasi dan cara memperbaikinya.
3. **Tiga bentuk distribusi** — library (`@pagescope/core`), CLI (`pagescope`), dan workflow GitHub Actions.

### Masalah yang disasar

Pemeriksaan SEO/technical correctness saat ini terpecah antara:

- Tool berbayar & GUI (Screaming Frog, Ahrefs) yang tidak CI-native dan tidak bisa dipakai sebagai gate otomatis.
- Lighthouse yang fokusnya performance, memerlukan Chromium di runner, dan hanya mencakup sebagian kecil audit SEO/technical.
- Skrip ad-hoc milik masing-masing tim yang tidak punya model status, tidak membedakan "error" dari "lulus", dan tidak memberi bukti.

PageScope mengambil irisan sempit itu dan mengerjakannya dengan benar: **deterministik, cepat, tanpa browser, dengan bukti.**

### 1.1 Kompetitor langsung yang ditemukan saat verifikasi

Pemeriksaan registry npm pada 2026-11-02 menemukan bahwa nama **`sitescope` sudah terpakai**: `sitescope@1.0.0` milik user `omlahore` (MIT, dipublikasikan 2026-03-18, repo `github.com/omlahore/sitescope`, 2 stars, 0 forks, push terakhir 2026-03-18).

Deskripsi package tersebut: *"One-command website health report. Performance, SEO, security, and accessibility — zero config, zero dependencies."* — 37+ check, tanpa browser, output JSON + HTML, flag `--ci --min-score <n>`, deteksi broken link, cek robots.txt/sitemap.

**Konsekuensi untuk proyek ini:**

1. **Nama package `sitescope` tidak dapat dipakai.** `npx sitescope` akan menjalankan package orang lain. **Keputusan: produk dinamai PageScope**, dengan package npm `pagescope` dan `@pagescope/core` (keduanya 404 di registry saat verifikasi) serta bin `pagescope`.
2. **Wedge A+B justru tervalidasi** — ada tool yang menggarap irisan yang sama dan berhenti di 2 stars, yang berarti permintaannya ada tetapi eksekusinya belum memuaskan.
3. **Perbedaan teknis kita bersifat struktural, bukan kosmetik:**

| Aspek | `sitescope` (omlahore, menurut README-nya) | PageScope (desain ini) |
|---|---|---|
| Parser HTML | *"HTML parser (regex-based)"* — regex tidak dapat spec-compliant secara konstruksi | `parse5` (HTML5 spec) + `sourceCodeLocation` |
| Model hasil | `status: "pass" \| "warn" \| "fail"` (3 nilai) | 5 nilai, termasuk `error` dan `not-applicable` — check yang tidak jalan tidak bisa menyamar sebagai lulus |
| Gate CI | `--ci --min-score <n>` berbasis skor | `--fail-on <severity>` berbasis status; skor sengaja tidak ada |
| Output | JSON + HTML | JSON ber-schema-version + Markdown + HTML nol-JS |
| Bukti | `{ id, status, label, detail }` | Union evidence termasuk `absence`, dengan baris/kolom |
| Perbaikan | — | `Patch` dengan penanda `exact` |
| Pembaruan terakhir | 2026-03-18, tidak ada aktivitas sejak itu | — |

Klaim pada tabel ini berasal dari README publik mereka, bukan dari pembacaan source code, dan karena itu diperlakukan sebagai klaim pihak ketiga.

---

## 2. Definisi Sukses

Bukan metrik popularitas. Semua poin di bawah harus **dibuktikan lewat eksekusi**, bukan diklaim:

1. Orang asing dapat menjalankan `npx pagescope audit https://example.com` dan memperoleh report bermakna tanpa membaca dokumentasi.
2. Setiap finding menyertakan snippet sumber asli yang dapat ditemukan dengan Ctrl+F pada halaman target.
3. Menambah satu rule baru hanya menyentuh: 1 file rule, 1 file test, 1 baris registrasi, 1 file dokumentasi rule — dan `CONTRIBUTING.md` menjelaskan urutan ini.
4. Exit code konsisten dengan `--fail-on`; finding tanpa policy tidak menggagalkan build.
5. Test suite lulus dari clone bersih **tanpa akses jaringan internet**.
6. Halaman yang gagal diambil menghasilkan status `error` dan **tidak pernah** tampil sebagai "0 findings, passed".

---

## 3. Scope v1

| Area | Isi |
|---|---|
| Engine | Rule contract, audit lifecycle, aggregation, error normalization, model status 5-nilai |
| Parsing | `parse5` dengan `sourceCodeLocationInfo: true` → setiap finding punya lokasi sumber |
| Fetch | `undici` dengan timeout, batas ukuran body, batas redirect, dan penolakan alamat privat/reserved **di connect-time** (dibuktikan lewat test) |
| Rules | 13 rule teruji, masing-masing dengan dokumentasi "apa yang diperiksa / apa yang TIDAK diperiksa" |
| Reporters | JSON (schema ber-versi), Markdown, HTML standalone |
| CLI | `pagescope audit <url>` + flag terdokumentasi (lihat §8) |
| Library | `import { audit } from '@pagescope/core'` |
| Distribusi | Contoh workflow GitHub Actions + fixture site untuk demo |
| Dokumentasi | README, CONTRIBUTING (termasuk panduan menulis rule), SECURITY, LICENSE, arsitektur, threat model |

### Non-goals v1 (ditulis di README sebagai "planned", tidak disembunyikan)

| Ditunda | Alasan |
|---|---|
| Browser audit (Playwright / axe-core / Lighthouse) | Chromium tidak dapat dijalankan di Workers; inti positioning v1 justru "tanpa browser". Butuh isolasi eksekusi terpisah yang tidak dapat diverifikasi di environment pengembangan ini. |
| Hosted public auditing & web dashboard | SSRF + resource exhaustion. Enforcement batas jaringan belum dapat diverifikasi, sehingga tidak boleh diklaim aman. Dashboard tanpa audit hosted tidak punya data nyata. |
| Cloudflare deployment | Tidak ada requirement nyata di v1. Deployment yang tidak terverifikasi lebih buruk daripada tidak ada deployment. Akan didokumentasikan sebagai rencana dengan prasyarat keamanan. |
| D1 / R2 / Queues | Tidak ada data yang perlu dipersistenkan di v1. |
| Akun, riwayat audit, crawling, monitoring terjadwal, AI | Tidak diminta oleh pengguna hari pertama; menambah biaya dukungan. |
| Broken-link check | Butuh N request tambahan dengan batas konkurensi; sumber false-positive terbesar (403 bot protection, 429). Perlu desain tersendiri → v1.1. |
| `form-labels` rule | Label implisit (`<input>` di dalam `<label>` tanpa `for`) mudah menimbulkan false positive bila tidak dikerjakan hati-hati → v1.1. |

**Catatan jujur atas konsekuensi keputusan ini:** dari 10 milestone pada dokumen prompt asli, 6 di antaranya (browser adapter, web dashboard, Cloudflare deployment, D1/R2/Queues, scheduled monitoring, AI) **tidak dikerjakan di v1**. Ini keputusan sadar, bukan kelalaian, dan tidak boleh dilaporkan sebagai selesai.

---

## 4. Keputusan Teknis & Bukti

Setiap keputusan di bawah disertai status verifikasinya. Yang **belum** terverifikasi dinyatakan terbuka, bukan disamarkan.

| Keputusan | Pilihan | Bukti / status |
|---|---|---|
| Bahasa | TypeScript | — |
| Struktur repo | 2 package (`@pagescope/core` + `pagescope` CLI) dalam pnpm workspace | Dipilih dari 3 pendekatan (§5) |
| Nama & distribusi | **PageScope** — package `pagescope`, scope `@pagescope/core`, bin `pagescope` | `npm view sitescope version` → **TAKEN** (`1.0.0`, omlahore); `npm view pagescope version` → 404; `npm view @pagescope/core version` → 404. Detail di §1.1. |
| Parser HTML | `parse5@8.1.0` | **Terverifikasi** dari TypeDoc resmi: `ParserOptions.sourceCodeLocationInfo?: boolean`; bila `true`, tiap node (kecuali root) punya `sourceCodeLocation`; node yang dibuat implisit → `undefined`; default `false`. README `htmlparser2` sendiri menyatakan parse5 adalah pilihan untuk "strict HTML spec compliance". |
| Alternatif parser | `htmlparser2@12.0.0` — **tidak dipakai** | **Terverifikasi** mendukung `withStartIndices`/`withEndIndices` → field `startIndex`/`endIndex`. Ditolak karena tidak spec-compliant; auditor yang berbeda interpretasi dari browser berisiko menghasilkan finding salah. Benchmark di README htmlparser2: ~2,2 ms/file (htmlparser2) vs ~9,7 ms/file (parse5) — selisih tidak relevan untuk target <3 detik. |
| HTTP client | `undici@8.12.3` | Versi terverifikasi ada di registry. **Bentuk opsi `connect.lookup` BELUM diverifikasi di sesi ini** — wajib dibaca dari dokumentasi resmi sebelum implementasi. Alternatif bila tidak tersedia: `node:http` dengan `lookup` kustom (enforcement tetap di connect-time). |
| Validasi skema | `zod@4.6.7` | Versi terverifikasi ada di registry |
| Parser argumen | `commander@15.0.0` | Versi terverifikasi ada di registry |
| Test runner | `vitest@5.1.0` | **Terverifikasi** `engines.node = ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |
| Bundler | `tsup@9.0.0` | **Terverifikasi** `engines.node = ^22.18.0 \|\| ^24.11.0 \|\| >=26.0.0` |
| TypeScript | **`5.9.3`, bukan `7.0.2`** | `dist-tags.latest` saat verifikasi = `7.0.2` (stabil), `^5` terbaru = `5.9.3`. Dipilih 5.9.3 karena pembuatan `.d.ts` (tsup / rollup-plugin-dts) bergantung pada TypeScript compiler API, dan **tidak ada bukti** jalur itu sudah matang pada implementasi native TS 7. Keputusan dapat ditinjau ulang; ini mitigasi risiko, bukan klaim bahwa TS 7 tidak berfungsi. |
| `@types/node` | `^22` | `latest` = `26.6.6`, tidak sesuai runtime minimum. Dipin ke `^22` agar tipe tidak mengklaim API yang tidak ada di Node 22. |
| Node minimum | 22 | Environment pengembangan: `v22.22.2`; memenuhi engine vitest & tsup |
| Package manager | pnpm | `11.21.0` terpasang di environment; lockfile akan di-commit |
| Skor | **Tidak ada skor** | Skor adalah metrik pertama yang dituntut orang dan akan memindahkan produk ke kompetisi yang sudah dimenangkan Lighthouse. Diganti model status + policy threshold eksplisit. |

---

## 5. Arsitektur

### 5.1 Pendekatan yang dievaluasi

| | Setup kontributor | Kecepatan rilis | Isolasi dependency berat | "Engine reusable" |
|---|---|---|---|---|
| Single package | paling mudah | paling cepat | buruk | klaim saja |
| Monorepo 7 package (prompt asli) | berat | lambat | terbaik | klaim saja |
| **2 package (dipilih)** | mudah | cepat | baik | nyata & dapat didemokan |

Alasan pemilihan: jalur masuk kontributor menjadi jelas — tulis rule, uji lewat library API, tanpa menyentuh CLI. Monorepo 7 package ditolak karena 5 dari 7 package akan kosong secara fungsi pada v1, dan dokumen prompt asli sendiri melarang pembuatan package kosong agar repo terlihat canggih.

### 5.2 Struktur repo

```
website-auditor/
  packages/
    core/                     @pagescope/core
      src/
        contracts/            tipe + skema zod (AuditResult, Finding, dst.)
        engine/               lifecycle, aggregation, error normalization
        collection/           fetch (undici), url-safety, parse (parse5)
        rules/                registri + 13 rule
        reporters/            json, markdown, html
        index.ts              API publik library
      test/
        rules/                unit test per rule (string HTML inline)
        integration/          server node:http lokal
        security/             tabel §7.3
        reporters/            konsistensi lintas format + injeksi
      fixtures/               halaman HTML untuk demo & test
    cli/                      pagescope (bin)
      src/                    arg parsing, exit code, file output, terminal rendering
      test/                   test dengan spawn binary hasil build
  examples/
    github-actions/audit.yml
  docs/
    architecture.md
    security/threat-model.md
    rules/*.md                satu file per rule
    contributing/adding-a-rule.md
    superpowers/specs/        dokumen ini
  .github/workflows/ci.yml
  README.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  LICENSE
  package.json  pnpm-workspace.yaml  tsconfig.base.json
```

### 5.3 Prinsip: collection ≠ evaluation

Rule **tidak melakukan network call dan tidak mem-parsing HTML**. Engine melakukan keduanya sekali, lalu memberi rule sebuah snapshot. Konsekuensi: setiap rule dapat diuji tanpa jaringan dan tanpa HTTP server — test cukup memberi string HTML. Ini prasyarat agar "kontributor dapat menambah rule" realistis.

---

## 6. Data Contracts

Semua kontrak didefinisikan di `packages/core/src/contracts/` dan divalidasi dengan zod pada batas kepercayaan (input config, output report).

### 6.1 Model status

```ts
type RuleStatus = 'passed' | 'failed' | 'needs-review' | 'not-applicable' | 'error'
```

- `error` **hanya** di-set oleh engine ketika rule melempar exception. Rule tidak boleh mengaku `passed` bila gagal dijalankan.
- `needs-review` untuk kondisi ambigu (mis. heading hierarchy melompat tetapi halaman memakai `<div role="heading" aria-level>`).
- `not-applicable` ketika rule tidak relevan (mis. cek canonical pada halaman non-HTML).

### 6.2 Snapshot input rule

```ts
interface AuditSnapshot {
  requestedUrl: string
  finalUrl: string              // setelah redirect
  httpStatus: number
  headers: HeadersSummary       // dinormalisasi & di-redact
  redirectChain: string[]
  html: string                  // dipotong bila melebihi batas
  document: Document            // parse5 dengan sourceCodeLocation
  truncated: boolean            // body > limit?
}
```

### 6.3 Rule contract

```ts
interface RuleDefinition {
  id: string                    // 'seo/title' — stabil, namespaced
  category: 'seo' | 'technical' | 'security' | 'accessibility'
  title: string
  description: string
  docsSlug: string              // → docs/rules/<slug>.md
  appliesTo: (s: AuditSnapshot) => boolean
  evaluate: (s: AuditSnapshot) => RuleResult
}

interface RuleResult {
  status: 'passed' | 'failed' | 'needs-review' | 'not-applicable'
  findings: FindingDraft[]      // wajib kosong bila passed / not-applicable
  note?: string                 // mis. '7 <img> diperiksa'
}
```

`evaluate` **wajib sinkron dan pure**. Cek yang membutuhkan network tambahan bukan rule biasa — itu task terpisah pada fase collection. Ini mencegah rule diam-diam melakukan puluhan request.

### 6.4 Evidence — union, bukan `selector: string`

```ts
type Evidence =
  | { kind: 'html-snippet'; snippet: string; line: number; column: number; truncated: boolean }
  | { kind: 'http-header'; name: string; value: string }          // nilai sensitif di-redact
  | { kind: 'http-response'; status: number; finalUrl: string; redirectChain: string[] }
  | { kind: 'measurement'; label: string; value: string | number; unit?: string }
  | { kind: 'absence'; expected: string; scope: string }
```

`absence` adalah jenis evidence yang wajib ada: untuk "title kosong", bukti jujurnya adalah *"tidak ditemukan `<title>` setelah memindai seluruh `<head>` (14 node)"* — **bukan** snippet palsu. Ini menegakkan aturan anti-fabrication secara struktural.

### 6.5 Patch

```ts
interface Patch {
  kind: 'insert' | 'replace'
  target: 'html' | 'http-headers'
  before?: string
  after: string
  exact: boolean        // false = template, bukan hasil pasti
}
```

`seo/title` tidak dapat menghasilkan judul yang benar, sehingga `exact: false` dengan `after: '<title>{{judul halaman}}</title>'`. Untuk `technical/duplicate-id` atau `seo/canonical`, patch dapat `exact: true`.

### 6.6 Finding dan AuditResult

```ts
type Severity   = 'critical' | 'high' | 'medium' | 'low' | 'info'
type Confidence = 'high' | 'medium' | 'low'

interface Finding {
  ruleId: string
  category: RuleDefinition['category']
  status: 'failed' | 'needs-review'
  severity: Severity
  confidence: Confidence        // TERPISAH dari severity
  title: string
  description: string
  target: { url: string }
  location?: { line: number; column: number }
  evidence: Evidence[]
  recommendation: string
  docsUrl: string
  patch?: Patch
}

interface AuditResult {
  schemaVersion: '1.0.0'
  audit: { startedAt: string; finishedAt: string; durationMs: number }
  target: {
    requestedUrl: string
    finalUrl: string | null
    httpStatus: number | null
    redirectChain: string[]
  }
  status: 'completed' | 'partial' | 'failed'
  rules: RuleExecutionSummary[]      // satu entri per rule, termasuk yang error
  findings: Finding[]
  errors: AuditError[]
  environment: { pagescopeVersion: string; node: string }
  limitations: string[]              // mis. 'JavaScript tidak dieksekusi'
}

interface AuditError {
  code:
    | 'INVALID_URL' | 'UNSUPPORTED_PROTOCOL' | 'BLOCKED_ADDRESS'
    | 'DNS_FAILURE' | 'FETCH_TIMEOUT' | 'TOO_MANY_REDIRECTS'
    | 'RESPONSE_TOO_LARGE' | 'NON_HTML_RESPONSE' | 'RULE_CRASH'
  message: string
  ruleId?: string
}
```

**Aturan keras:** `status: 'failed'` (target tidak dapat diambil) tidak boleh menghasilkan `findings: []` dengan `status: 'completed'`.

### 6.7 Redaction di layer collection

`HeadersSummary` membuang nilai `set-cookie` (hanya menyimpan nama cookie) dan tidak pernah mencatat nilai `authorization`. Redaction dilakukan di collection, bukan di reporter, sehingga tidak dapat bocor melalui format output baru di masa depan.

### 6.8 Versioning

`SCHEMA_VERSION = '1.0.0'` sebagai konstanta tunggal. JSON report divalidasi zod **sebelum** serialisasi. Perubahan aditif = minor, breaking = major.

---

## 7. Rule Set v1 — 13 rule

Setiap rule memiliki satu file dokumentasi di `docs/rules/<slug>.md` yang memuat: apa yang diperiksa, apa yang **tidak** diperiksa, kondisi passed/failed/needs-review/not-applicable, kriteria severity, contoh evidence, dan referensi resmi bila ada.

| ID | Kategori | Severity | Diperiksa | **Tidak** diperiksa |
|---|---|---|---|---|
| `seo/title` | seo | high | `<title>` ada dan tidak kosong | kualitas, panjang, kata kunci |
| `seo/meta-description` | seo | medium | `<meta name=description>` ada dan tidak kosong | dampak ranking — **tidak diklaim** |
| `seo/canonical` | seo | low | `<link rel=canonical>` ada dan absolut | apakah canonical "benar" untuk bisnis pemilik situs |
| `seo/robots-meta` | seo | medium | `noindex`/`nofollow` → `needs-review`, bukan `failed` | niat pemilik situs; halaman staging memang sering `noindex` |
| `seo/open-graph` | seo | low | `og:title`, `og:description`, `og:image`, `og:url` ada | apakah gambar benar-benar tampil di platform sosial |
| `seo/heading-structure` | seo | medium | `<h1>` berjumlah 0 atau >1; level heading melompat | >1 `<h1>` **legal** di HTML5 → `needs-review`; struktur via `role="heading"` tidak terdeteksi |
| `technical/duplicate-id` | technical | medium | atribut `id` duplikat; patch `exact: true` | apakah JavaScript pemilik situs bergantung pada duplikasi tersebut |
| `technical/meta-viewport` | technical | medium | `<meta name=viewport>` ada | kualitas nilai viewport |
| `technical/http-status` | technical | high | status final bukan 2xx | apakah 404 tersebut wajar |
| `a11y/img-alt` | accessibility | medium | `<img>` tanpa atribut `alt`; `alt=""` dianggap **passed** (dekoratif) | apakah isi `alt` bagus |
| `a11y/html-lang` | accessibility | medium | `<html lang>` ada dan tidak kosong | apakah nilai `lang` sesuai bahasa aktual |
| `security/https` | security | high | scheme bukan https, atau redirect http→https tidak tersedia | validitas sertifikat (tugas browser) |
| `security/security-headers` | security | low | HSTS / CSP / X-Content-Type-Options / Referrer-Policy | apakah konfigurasi header aman — **presence ≠ secure**, dinyatakan di docs |

### 7.1 Kriteria severity (didokumentasikan, bukan intuisi)

Severity mencerminkan **dampak yang dapat dibuktikan dari evidence**, bukan kategori:

- `high` — fitur dasar halaman rusak atau transport tidak terenkripsi (`seo/title` hilang, `technical/http-status` non-2xx, `security/https`).
- `medium` — metadata/struktur penting hilang atau ambigu (`meta-description`, `duplicate-id`, `img-alt`).
- `low` — perbaikan bersifat peningkatan, bukan kegagalan fungsi (`canonical`, `open-graph`, header keamanan).
- `critical` — **tidak ada rule v1 yang memakai `critical`.** Level ini disediakan untuk rule yang kelak dapat membuktikan kerusakan total (mis. halaman mengembalikan HTML kosong). Tidak ada rule yang otomatis `critical` hanya karena kategorinya security.

`confidence` terpisah: `a11y/img-alt` pada halaman yang memuat `<img>` dari CDN dengan atribut `alt` dinamis tetap `confidence: high` untuk *absensi atribut*, tetapi `confidence: low` untuk klaim dampaknya.

### 7.2 Batas klaim yang dilarang

Rule v1 **tidak boleh** menyatakan atau menyiratkan:

- bahwa automated check membuktikan kepatuhan WCAG;
- bahwa temuan header keamanan membuktikan exploitability;
- bahwa tidak adanya meta description menurunkan peringkat pencarian;
- bahwa respons non-200 adalah broken link.

---

## 8. Security Model (mode lokal)

An auditor yang mengambil URL sembarang dapat berubah menjadi proxy SSRF atau pintu resource exhaustion. Model ancaman lengkap ditulis di `docs/security/threat-model.md`; ringkasan kontrolnya:

### 8.1 Validasi URL

- Allowlist protokol: `http`, `https` saja.
- Tolak URL dengan kredensial (`user:pass@host`).
- Tolak karakter kontrol pada URL.

### 8.2 Penolakan alamat pada connect-time (inti argumen keamanan)

```ts
undici.Agent({ connect: { lookup } })
   └─ lookup kustom: resolve → validasi IP → tolak atau teruskan
```

Validasi terjadi di dalam `lookup`, sehingga IP yang dipakai untuk koneksi **adalah** IP yang divalidasi. Ini menutup celah DNS rebinding/TOCTOU yang tidak dapat ditutup oleh `new URL()` + `dns.resolve()` biasa.

Rentang yang ditolak:

- IPv4: loopback `127/8`, private `10/8`, `172.16/12`, `192.168/16`, link-local `169.254/16` (**termasuk metadata endpoint `169.254.169.254`**), CGNAT `100.64/10`, `0.0.0.0/8`, multicast `224/4`, reserved `240/4`.
- IPv6: `::1`, ULA `fc00::/7`, link-local `fe80::/10`, multicast `ff00::/8`, serta **IPv4-mapped IPv6** `::ffff:0:0/96` (mis. `::ffff:127.0.0.1`) yang divalidasi sebagai IPv4 hasil mapping.

**Status verifikasi:** bentuk opsi `connect.lookup` pada `undici@8.12.3` **belum diverifikasi**. Langkah pertama implementasi §8 adalah membaca dokumentasi resmi undici dan menjalankan eksperimen minimal. Bila tidak tersedia, gunakan `node:http`/`node:https` dengan `lookup` kustom — mekanisme enforcement tetap sama (connect-time).

### 8.3 Redirect

`redirect: 'manual'`, diikuti secara manual, **setiap hop divalidasi ulang** dengan mekanisme yang sama, maksimum 5 hop. Melampaui batas → `TOO_MANY_REDIRECTS`.

### 8.4 Batas sumber daya

| Batas | Nilai | Penanganan |
|---|---|---|
| Timeout total | 10.000 ms (dapat diubah via `--timeout`) | `FETCH_TIMEOUT` |
| Ukuran body | 5 MB | streaming, di-abort saat terlampaui → `RESPONSE_TOO_LARGE`, tanpa buffering penuh |
| Redirect | 5 hop | `TOO_MANY_REDIRECTS` |
| Konkurensi | 1 | v1 hanya satu halaman |

### 8.5 Guard harus dapat di-inject untuk test

Test membutuhkan server di `127.0.0.1`, padahal loopback justru diblokir. Karena itu guard bersifat injectable melalui opsi internal `allowPrivateNetworks`, yang **tidak pernah** diekspos ke CLI, config file, maupun API publik library.

### 8.6 Test keamanan wajib (membuktikan guard, bukan mem-parse URL)

| Kasus | Harapan |
|---|---|
| `http://127.0.0.1:PORT/` | `BLOCKED_ADDRESS` |
| `http://localhost/` | `BLOCKED_ADDRESS` |
| `http://[::1]/` | `BLOCKED_ADDRESS` |
| `http://169.254.169.254/latest/meta-data/` | `BLOCKED_ADDRESS` |
| `http://[::ffff:127.0.0.1]/` | `BLOCKED_ADDRESS` |
| `http://10.0.0.1/` | `BLOCKED_ADDRESS` |
| 302 hop-1 publik → hop-2 `169.254.169.254` | `BLOCKED_ADDRESS` pada hop 2 |
| 6× redirect | `TOO_MANY_REDIRECTS` |
| body 20 MB | `RESPONSE_TOO_LARGE` tanpa kehabisan memori |
| server tidak pernah merespons | `FETCH_TIMEOUT` |

Baris ke-5 dan ke-7 adalah alasan utama desain ini ada.

### 8.7 Keamanan output

1. **Terminal injection.** Semua teks berasal dari target melewati `sanitizeForTerminal()` (buang escape ANSI, kontrol C0/C1, karakter bidi override) sebelum dicetak. Test menggunakan fixture HTML dengan judul berisi escape sequence dan meng-assert output tidak memuat `\u001b`.
2. **Path confusion.** Nama file **tidak pernah** diturunkan dari URL target. Satu-satunya sumber path adalah argumen `--out` literal dari pengguna.
3. **HTML report.** Semua nilai dinamis melewati satu fungsi `escapeHtml()`; tidak ada JavaScript di report; CSP `default-src 'none'; style-src 'unsafe-inline'` disisipkan sebagai meta.
4. **Log.** Tidak ada header `authorization` atau nilai `set-cookie` yang ditulis ke log, report, atau error message.

### 8.8 Mode hosted dinyatakan di luar lingkup

Tidak ada endpoint publik pada v1. `SECURITY.md` menyatakan bahwa siapa pun yang meng-host PageScope secara publik bertanggung jawab atas auth, rate limiting, dan isolasi jaringan, dan bahwa desain ini **belum** menyediakan kontrol tersebut.

---

## 9. CLI Contract

```
pagescope audit <url> [options]
```

| Flag | Default | Perilaku |
|---|---|---|
| `--format <json\|markdown\|html\|all>` | `markdown` bila stdout bukan TTY, ringkasan bila TTY | `all` menulis tiga file dan mewajibkan `--out` |
| `--out <path>` | stdout | Menolak bila path merupakan direktori |
| `--fail-on <critical\|high\|medium\|low\|info\|none>` | `none` | Gate: exit 1 bila ada finding dengan severity ≥ nilai ini |
| `--rules <id,id>` / `--exclude-rules <id,id>` | semua | ID tidak dikenal → exit 2 dengan saran ID terdekat |
| `--timeout <ms>` | `10000` | Batas per request |
| `--config <path>` | `pagescope.config.json` bila ada | Divalidasi zod; **key tidak dikenal = exit 2** |
| `--verbose` | off | Stack trace + detail fetch ke stderr |
| `--no-color` | auto | Menghormati `NO_COLOR` |

**Alasan `--fail-on` default `none`:** perintah pertama yang dijalankan orang adalah `npx pagescope audit situs-saya.com`. Bila perintah itu keluar dengan exit 1, kesan pertamanya "tool-nya rusak". Gate harus opt-in eksplisit — dan justru itu yang membuatnya cocok untuk CI, karena konfigurasinya ditulis sendiri oleh pengguna.

### 9.1 Exit codes

| Code | Arti |
|---|---|
| `0` | Audit selesai (`completed` atau `partial`), policy lolos |
| `1` | Audit selesai, policy dilanggar |
| `2` | Input/konfigurasi tidak valid (URL salah, flag salah, config invalid) |
| `3` | Target tidak dapat diaudit (DNS gagal, diblokir, timeout, non-HTML) |

Audit parsial **tidak** memiliki exit code tersendiri: ia melaporkan `status: 'partial'`, mencetak peringatan ke stderr, dan exit code tetap mengikuti policy. Alasan: menambah exit code kelima untuk kondisi yang jarang membuat Action di repo orang lain gagal dengan cara yang tidak mereka pahami. Yang penting adalah `partial` terlihat dan tercatat di report.

### 9.2 Output terminal

Ringkasan manusiawi dengan glyph **dan** kata (`✓ passed`, `✗ failed`, `! needs review`, `? not applicable`), sehingga status tidak hanya dikomunikasikan lewat warna. Semua teks dari target melewati `sanitizeForTerminal()`.

---

## 10. Reporters

Kontrak tunggal: `(result: AuditResult) => string`. Ketiga reporter mengonsumsi **objek yang sama**; tidak ada perhitungan ulang finding di reporter.

| Format | Keputusan teknis |
|---|---|
| **JSON** | Pretty-print 2 spasi, divalidasi zod sebelum serialisasi, `schemaVersion` selalu ada |
| **Markdown** | Deterministik, dikelompokkan per severity; snippet di-fence sebagai code block; karakter kontrol dibuang |
| **HTML** | Satu file mandiri, **nol JavaScript**, nol request eksternal, `<details>` untuk collapsible, semua nilai dinamis melewati `escapeHtml()`, CSP meta disisipkan |

### 10.1 Test lintas format

Untuk satu `AuditResult` yang sama, assert bahwa jumlah finding, himpunan `ruleId`, dan severity-nya identik di ketiga format. Test injeksi: fixture dengan `<script>alert(1)</script>` di dalam atribut `title` dan di dalam teks → assert output HTML tidak memuat `<script` mentah.

---

## 11. Integrasi GitHub Actions

Yang dikirim v1 adalah **contoh workflow yang benar-benar dijalankan**, bukan Action di Marketplace (klaim Marketplace memerlukan publikasi package + tag, dan tidak boleh diklaim sebelum terjadi):

```yaml
# examples/github-actions/audit.yml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npx pagescope@latest audit "${{ inputs.url }}" \
         --format markdown --out pagescope-report.md --fail-on high
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: pagescope-report, path: pagescope-report.md }
```

`if: always()` bukan kosmetik: ketika audit gagal, report justru yang paling dibutuhkan.

---

## 12. Testing Strategy

| Lapis | Cara | Determinisme |
|---|---|---|
| Unit rule | string HTML inline → `parse5` → `evaluate()` | 100% offline |
| Integration | server `node:http` lokal + fixture | offline |
| CLI | spawn binary hasil build (`node:child_process`), assert exit code + file output | offline |
| Security | tabel §8.6 | offline |
| Reporter | satu `AuditResult` → tiga format → assert konsistensi; injeksi HTML & terminal | offline |

**Tidak ada test yang memanggil internet.** Test yang bergantung pada `example.com` bersifat rapuh dan menjadi alasan orang berhenti berkontribusi.

### 12.1 Cakupan test CLI (yang benar-benar dijalankan)

URL valid, URL invalid, protokol tak didukung, config invalid, audit sukses, gate gagal, audit parsial, network failure, timeout, output JSON, output Markdown, pembuatan file output, dan exit code `0/1/2/3`.

---

## 13. CI

GitHub Actions, matrix Node **22 dan 24**:

```
pnpm install --frozen-lockfile
→ tsc --noEmit (typecheck)
→ lint + format check
→ vitest run
→ build (tsup)
→ npm pack --dry-run
→ smoke test CLI terhadap fixture server lokal
```

Tidak ada check yang di-disable untuk membuat workflow hijau. Bila sebuah check gagal, penyebabnya diperbaiki.

---

## 14. Repository & Dokumentasi

| File | Isi wajib |
|---|---|
| `README.md` | Deskripsi, positioning, batas klaim, instalasi, quick start, contoh CLI, contoh report, arsitektur ringkas, model keamanan, **Known Limitations**, cara test, cara kontribusi, lisensi |
| `CONTRIBUTING.md` | Setup dev, struktur repo, cara menjalankan test, **cara menambah rule** (urutan 5 file), konvensi kode, ekspektasi PR |
| `SECURITY.md` | Cara melaporkan isu (tanpa mengarang alamat kontak privat), tanggung jawab self-hoster |
| `CODE_OF_CONDUCT.md` | Contributor Covenant dengan atribusi |
| `LICENSE` | MIT (dipilih karena kompatibel dengan seluruh dependency yang direncanakan) |
| `docs/architecture.md` | Batas package, alur audit, keputusan desain |
| `docs/security/threat-model.md` | Model ancaman §8 diperluas |
| `docs/rules/*.md` | 13 file, satu per rule |
| `docs/contributing/adding-a-rule.md` | Panduan langkah demi langkah |
| `.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md` | Bug report, feature request, PR |
| `packages/core/fixtures/` | Halaman HTML nyata untuk demo & test |

Screenshot/report contoh **wajib diberi label** sebagai data dari fixture, bukan hasil audit situs nyata.

---

## 15. Roadmap setelah v1 (belum dikerjakan, tidak boleh dilaporkan selesai)

| Item | Prasyarat |
|---|---|
| `--baseline` (gagal hanya pada finding baru) | Desain fingerprint finding yang stabil (ruleId + lokasi + evidence hash) agar baseline tidak berubah sendiri |
| Broken-link check | Batas konkurensi, klasifikasi 403/429 sebagai `needs-review`, bukan `failed` |
| Rule `form-labels` | Deteksi label implisit tanpa false positive |
| Browser audit (Playwright + axe-core + Lighthouse) | Environment eksekusi terisolasi; **bukan** bagian dari package core |
| Web dashboard | Bergantung pada keputusan hosting; tanpa audit hosted, UI tidak punya data nyata |
| Cloudflare deployment | Hanya bila ada profil hosting dengan auth + rate limit + isolasi jaringan yang terverifikasi |
| Public `action.yml` di Marketplace | Publikasi package ke npm + tag rilis |

---

## 16. Risiko & Hal yang Belum Terverifikasi

| # | Belum terverifikasi | Rencana |
|---|---|---|
| 1 | Bentuk opsi `connect.lookup` pada `undici@8.12.3` | Baca dokumentasi resmi + eksperimen minimal sebelum menulis collection layer. Fallback: `node:http`/`node:https`. |
| 2 | Kematangan `.d.ts` bundling bila memakai TypeScript 7 | Mitigasi: pin `5.9.3`. Dapat ditinjau ulang. |
| 3 | Perilaku `sourceCodeLocation` pada node hasil koreksi tree | Diuji pada tahap engine: fixture dengan HTML rusak (`<p>` tak tertutup) → assert node implisit tidak diberi lokasi palsu, dan rule wajib menangani `undefined`. |
| 4 | Apakah `parse5` menyediakan posisi level atribut untuk snippet presisi | Diuji sebelum reporter HTML: bila tidak tersedia, snippet diambil pada level elemen dan didokumentasikan sebagai keterbatasan. |
| 5 | Kebutuhan nyata aturan panjang/format judul dan meta description | Ditunda sampai ada permintaan pengguna nyata; v1 hanya memeriksa keberadaan. |
| 6 | Nama package npm `sitescope` sudah dipakai pihak lain (`sitescope@1.0.0`, omlahore) | **Terselesaikan:** produk dinamai PageScope; `pagescope` dan `@pagescope/core` masih 404 di registry saat verifikasi. Risiko sisa: nama dapat diambil pihak lain sebelum publikasi pertama, dan scope `@pagescope` belum tentu dapat didaftarkan — diverifikasi pada langkah publish pertama. |

---

## 17. Acceptance Criteria v1

v1 dinyatakan selesai hanya bila **seluruh** poin berikut terbukti lewat eksekusi:

**Engine & rules**
- [ ] 13 rule terdaftar, masing-masing punya file dokumentasi
- [ ] Status `error` hanya berasal dari engine, tidak pernah dari rule
- [ ] Satu rule yang crash tidak menggagalkan rule lain; `AuditResult.status` menjadi `partial`
- [ ] Target yang gagal diambil → `status: 'failed'`, bukan `completed` dengan 0 finding
- [ ] Setiap finding memiliki ≥1 evidence, dan evidence `absence` dipakai untuk kondisi "tidak ditemukan"

**Security**
- [ ] 10 kasus di §8.6 lulus
- [ ] `allowPrivateNetworks` tidak dapat diaktifkan dari CLI maupun config file (diuji)
- [ ] Test injeksi terminal dan HTML lulus

**CLI**
- [ ] `pagescope audit <url>` berjalan nyata terhadap fixture lokal
- [ ] Empat exit code terbukti lewat spawn binary
- [ ] `--format all` menulis tiga file valid

**Reporters**
- [ ] JSON tervalidasi zod dan memuat `schemaVersion`
- [ ] Konsistensi finding lintas tiga format terbukti

**Quality gate**
- [ ] `tsc --noEmit`, lint, vitest, dan build lulus dari clone bersih
- [ ] CI hijau pada Node 22 dan 24
- [ ] Tidak ada test yang memerlukan internet

**Open source readiness**
- [ ] README / CONTRIBUTING / SECURITY / LICENSE / CoC lengkap dan instruksinya benar-benar dijalankan
- [ ] Contoh workflow GitHub Actions ada
- [ ] Tidak ada secret di repo

---

## 18. Riwayat Keputusan Brainstorming

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Tujuan proyek | Produk nyata yang dipakai dan dikontribusi orang lain |
| 2 | Wedge | A (CI-native SEO/technical gate, tanpa browser) + B (evidence + patch) |
| 3 | Kapasitas waktu | Tidak terjadwal — milestone didefinisikan sebagai irisan vertikal yang bisa dikirim, tanpa estimasi waktu |
| 4 | Arsitektur | 2 package: `@pagescope/core` + `pagescope` CLI |
| 5 | Seksi 1 — scope & non-goals | Disetujui |
| 6 | Seksi 2 — data contracts | Disetujui |
| 7 | Seksi 3 — CLI, reporters, GitHub Action | Disetujui |
| 8 | Seksi 4 — rules, security, testing, CI | Disetujui |
| 9 | Nama package (bentrok dengan `sitescope` yang sudah ada di npm) | Ganti nama produk menjadi **PageScope**: package `pagescope` + `@pagescope/core`, bin `pagescope` |