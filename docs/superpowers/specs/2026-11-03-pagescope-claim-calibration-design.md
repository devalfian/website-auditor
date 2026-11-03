# PageScope — Spec C: Kalibrasi Klaim

- **Tanggal:** 2026-11-03
- **Status:** Disetujui melalui sesi brainstorming (Seksi 1-6)
- **Pendahulu:** `2026-11-02-pagescope-design.md` (v0.1.0, 13 rule, 145 test)
- **Posisi dalam roadmap:** fase **C** dari urutan **C → B → A**
- **Bahasa dokumen:** Indonesia (dokumen kerja internal). Dokumentasi publik tetap berbahasa Inggris.

---

## 1. Ringkasan

Fase ini menutup satu dari tiga limitasi v0.1.0 — limitasi yang **tidak dapat** ditutup oleh fase B (crawling) maupun fase A (browser), karena ia bersifat epistemik:

> _"Automated checks cannot establish WCAG conformance or prove that a page is exploitable."_

Spec ini tidak berjanji bahwa PageScope akan **membuktikan** lebih banyak. Ia menjamin bahwa PageScope **berhenti menyiratkan** lebih banyak daripada yang ia ketahui.

Tiga hasil konkret:

1. **Lulus palsu dihapus secara struktural.** Halaman yang dirender klien tidak lagi melaporkan `not-applicable` seolah kontennya sudah diperiksa; ia melaporkan `unobservable`.
2. **Setiap report menyatakan apa yang diperiksa dan apa yang tidak**, lewat blok `coverage` yang bersifat mesin-baca.
3. **`confidence` menjadi berkonsekuensi** — ia ikut menentukan apakah sebuah finding menggagalkan build, bukan hanya dicetak.

Fase ini **tidak** menambahkan satu rule pun. Jumlah rule tetap 13.

---

## 2. Masalah yang disasar

Tiga temuan dari pembacaan kode pada 2026-11-03. Masing-masing disertai lokasi persisnya, bukan dugaan.

### 2.1 `not-applicable` mencampur dua keadaan epistemik

`docs/architecture.md:37` mendefinisikan `not-applicable` sebagai _"the rule could not apply to this page (e.g. `img-alt` on a page with no images)"_.

`packages/core/src/rules/a11y.ts:15-17` mengembalikannya ketika `images.length === 0`:

```ts
if (images.length === 0) {
  return { status: 'not-applicable', findings: [], note: 'no <img> elements on the page' }
}
```

Pada halaman server-rendered, itu benar: seluruh body dipindai, memang nol `<img>`. Pada aplikasi yang dirender klien, `<body>` yang dipindai hanyalah cangkang kosong. **Dua keadaan yang berbeda secara epistemik menghasilkan status, glyph terminal (`[-]`), dan kalimat yang identik.**

Dari 13 rule, hanya 2 yang benar-benar membutuhkan DOM hasil render — `a11y/img-alt` dan `seo/heading-structure`. Sebelas sisanya membaca `<head>`, atribut `<html>`, header HTTP, atau status transport, yang seluruhnya tersedia di respons mentah.

### 2.2 `confidence` tidak mempengaruhi keputusan apa pun

Field ini ada di tipe (`contracts/types.ts:57`), di schema (`report-schema.ts:34`), dan dicetak oleh reporter Markdown (`markdown.ts:43`) serta HTML (`html.ts:54`). Namun:

| Tempat                      | Membaca `confidence` |
| --------------------------- | -------------------- |
| `reporters/markdown.ts`     | ya — dicetak         |
| `reporters/html.ts`         | ya — dicetak         |
| `cli/output.ts:51-61`       | **tidak**            |
| `cli/run.ts:220-222` (gate) | **tidak**            |
| `engine/baseline.ts`        | **tidak**            |

Nilai yang sudah ada ternyata konsisten dengan semantik yang koheren — `high` untuk bacaan langsung, `medium` untuk konvensi yang tidak dipaksakan spesifikasi, `low` untuk asumsi yang dinyatakan tetapi tidak dapat diverifikasi. Masalahnya bukan nilainya, melainkan bahwa tidak ada yang membacanya di tempat yang menentukan.

### 2.3 Gate menyatakan hal yang baru saja ia sangkal

`cli/run.ts:220-222`:

```ts
const policyFailed =
  failOn !== 'none' &&
  policyFindings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn])
```

Tidak ada filter `status`. Sementara `rules/seo.ts:286-301` menghasilkan finding berstatus **`needs-review`** dengan `severity: 'medium'` dan deskripsi:

> _"PageScope cannot determine which applies here."_

Konsekuensi hari ini: halaman ber-`noindex` **menggagalkan build** dengan `--fail-on medium`, sementara laporan pada saat yang sama menulis bahwa PageScope tidak tahu. Alat menegaskan apa yang baru saja ia sangkal.

Tidak ada test yang mengunci perilaku ini — kedua test gate (`cli.test.ts:120-134`) memakai finding ber-`status: 'failed'`. Perbaikan ini tidak memecahkan test yang ada.

### 2.4 `limitations` adalah konstanta global yang dikunci test

`engine/audit.ts:18-22` mendefinisikan `LIMITATIONS` sebagai array `readonly` statis, dan `test/engine/audit.test.ts:50` meng-assert `toEqual([...LIMITATIONS])`. Array itu tidak dapat berubah menurut apa yang benar-benar dilakukan audit. Begitu fase B atau A ada, report **pasti** berbohong atau test harus ditulis ulang.

Perubahan kontrak ini sama untuk ketiga fase, sehingga dikerjakan sekali di sini.

---

## 3. Keputusan desain

### 3.1 `unobservable` dimiliki engine, bukan rule

```ts
export type RuleStatus =
  | 'passed'
  | 'failed'
  | 'needs-review'
  | 'not-applicable'
  | 'unobservable' // baru
  | 'error'

export type EvaluatedStatus = Exclude<RuleStatus, 'unobservable' | 'error'>
```

`RuleResult.status` bertipe `EvaluatedStatus`, sehingga **rule secara tipe tidak dapat mengembalikan `unobservable`.** Ini bukan konvensi yang dijaga oleh review; compiler yang menegakkannya. Pola ini sudah dipakai untuk `error` (`architecture.md:38`), jadi ia memperluas invariant yang ada.

| Status             | Arti                                                                   | Pemilik    |
| ------------------ | ---------------------------------------------------------------------- | ---------- |
| `passed`           | Rule berjalan; kondisi terpenuhi pada data yang cukup                  | rule       |
| `failed`           | Rule berjalan; kondisi tidak terpenuhi pada data yang cukup            | rule       |
| `needs-review`     | Rule berjalan; jawaban bergantung pada niat yang tidak dapat diketahui | rule       |
| `not-applicable`   | Subjek rule **terverifikasi tidak ada** pada apa yang diperiksa        | rule       |
| **`unobservable`** | **Rule tidak dapat mengamati cukup banyak untuk menyimpulkan**         | **engine** |
| `error`            | Rule gagal berjalan                                                    | engine     |

`FindingStatus` **tidak berubah** (`'failed' | 'needs-review'`). `unobservable` tidak menghasilkan finding, sama seperti `not-applicable`.

`assertResultInvariants` (`engine/audit.ts:45`) tidak perlu diubah: `unobservable` berada di luar `producesFindings`, sehingga ia otomatis masuk cabang `!producesFindings && findings.length > 0 → throw`. Invariant "rule yang tidak berjalan tidak boleh dilaporkan sebagai `passed`" tetap utuh tanpa penambahan kode.

### 3.2 Rule mendeklarasikan representasi minimum

```ts
export type ObservationSource = 'served-html' | 'rendered-dom' | 'http-headers'

export interface RuleDefinition {
  // ...field yang sudah ada...
  /**
   * Representasi minimum yang dibutuhkan rule ini untuk mencapai kesimpulan.
   * 'served-html'   — byte yang dikirim server sudah cukup (8 dari 13 rule)
   * 'rendered-dom'  — butuh DOM setelah JavaScript berjalan (2 rule)
   * 'http-headers'  — hanya membaca status dan header respons (3 rule)
   */
  observation: ObservationSource
}
```

Penetapan untuk 13 rule yang ada:

| `observation`  | Rule                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `served-html`  | `seo/title`, `seo/meta-description`, `seo/canonical`, `seo/robots-meta`, `seo/open-graph`, `technical/duplicate-id`, `technical/meta-viewport`, `a11y/html-lang` |
| `rendered-dom` | **`seo/heading-structure`**, **`a11y/img-alt`**                                                                                                                  |
| `http-headers` | `technical/http-status`, `security/https`, `security/security-headers`                                                                                           |

### 3.3 Deteksi rendering bersifat positive-only

`packages/core/src/collection/rendering.ts` (baru):

```ts
export interface RenderingAssessment {
  kind: 'server-rendered' | 'client-rendered'
  reason: string
  evidence: Evidence[]
}

export function detectRendering(document: HtmlDocument, html: string): RenderingAssessment
```

Dua sinyal berpresisi tinggi. **Tidak ada ambang angka** ("body < 10 elemen" ditolak — itu evidence yang dikarang).

| Sinyal                                  | Kondisi                                                                                                 | Contoh                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A. Mount point kosong**               | Elemen dengan `id` atau tag yang dikenal sebagai root framework **dan** nol element child               | `<div id="root"></div>`, `<div id="__next"></div>`, `<div id="___gatsby"></div>`, `<app-root></app-root>` |
| **B. `<noscript>` menuntut JavaScript** | Teks `<noscript>` cocok `/enable javascript\|requires javascript\|javascript is (disabled\|required)/i` | `<noscript>You need to enable JavaScript to run this app.</noscript>`                                     |

**Sifat yang membuat ini aman:**

1. **Hanya menambah kejujuran.** Default adalah `server-rendered` — asumsi yang sama dengan v0.1.0. Perubahan ini tidak dapat membuat halaman yang normal tiba-tiba `unobservable`.
2. **Recall sengaja rendah.** SPA yang tidak memakai salah satu pola di atas tetap berperilaku seperti hari ini. Melewatkan deteksi = status quo; salah mendeteksi = finding palsu. Untuk alat yang menjual kejujuran, asimetri ini disengaja.
3. **Setiap penilaian membawa evidence.** Ketika sebuah rule menjadi `unobservable`, laporan dapat menunjuk elemen persis yang membuktikan mengapa.

Daftar root framework berada di satu konstanta bernama di `rendering.ts`. Menambah framework = satu baris + satu test di `rendering.test.ts`.

### 3.4 `confidence` dinamai, bukan dirancang ulang

Nilai yang ada sudah konsisten. Yang ditambahkan hanyalah definisi tertulis, masuk ke `CONTRIBUTING.md` dan setiap `docs/rules/*.md`:

> `high` — kesimpulan adalah bacaan langsung atas byte yang dikirim server, tanpa asumsi.
> `medium` — kesimpulan bergantung pada konvensi yang spesifikasinya tidak memaksa.
> `low` — kesimpulan bergantung pada asumsi yang PageScope nyatakan tetapi tidak dapat memverifikasi.

`confidence` **ortogonal** terhadap `severity` dan terhadap `status`: severity = dampak bila benar; confidence = seberapa banyak inferensi yang dibutuhkan kata "benar".

### 3.5 Gate membaca `status` lalu `confidence`, tanpa mengubah label

Dua perubahan di `cli/run.ts`:

```ts
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const

const policyFindings = (
  result.baseline
    ? result.findings.filter((finding) => finding.baseline === 'new')
    : result.findings
).filter((finding) => finding.status === 'failed') // perbaikan bug §2.3

const policyFailed =
  failOn !== 'none' &&
  policyFindings.some(
    (finding) =>
      SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn] &&
      CONFIDENCE_RANK[finding.confidence] >= CONFIDENCE_RANK[minConfidence],
  )
```

Flag baru: `--min-confidence <high|medium|low>`, **default `low`** — sehingga tidak ada finding yang pernah dikecualikan secara default, sejalan dengan `--fail-on` default `none`.

**Ditolak secara eksplisit:** mereklasifikasi `failed` → `needs-review` ketika confidence di bawah ambang. `needs-review` sudah memiliki arti spesifik (niat pemilik situs), dan mencampurnya dengan "inferensi kami lemah" akan mengaburkan satu-satunya status yang tersedia untuk ketidakpastian. Finding tetap dilaporkan `failed` di semua report; yang berubah hanya apakah ia **dihitung** oleh gate — dan ringkasan terminal mengatakannya:

```
gate: 2 failed findings below --min-confidence high were not counted
```

Dengan begitu laporan dan gate tidak pernah diam-diam berbeda pendapat.

### 3.6 Coverage bersifat mesin-baca; limitations diturunkan darinya

```ts
export type NotInspected = 'rendered-dom' | 'linked-pages' | 'wcag-conformance' | 'exploitability'

export interface AuditCoverage {
  representation: 'served-html' | 'rendered-dom'
  rendering: 'server-rendered' | 'client-rendered'
  renderingEvidence: Evidence[]
  rulesEvaluated: number
  unobservableRules: string[]
  notInspected: NotInspected[]
}
```

`notInspected` berupa enum, bukan prosa bebas. Ketika fase B selesai, menghapus `'linked-pages'` dari array membuat kalimat limitation-nya hilang sendiri — tanpa arkeologi string.

`limitations: string[]` **tetap ada** di `AuditResult`, tetapi kini dihasilkan oleh:

```ts
export function limitationsFor(coverage: AuditCoverage): string[]
```

| Kondisi                                                 | Kalimat                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `notInspected` ∋ `wcag-conformance` \| `exploitability` | _"Automated checks cannot establish WCAG conformance or prove that a page is exploitable."_                                      |
| `notInspected` ∋ `rendered-dom`                         | _"JavaScript is not executed: only the raw HTML response is inspected."_                                                         |
| `rendering === 'client-rendered'`                       | _"This page appears to be rendered client-side; rules that need the rendered DOM reported `unobservable` rather than guessing."_ |
| `notInspected` ∋ `linked-pages`                         | _"Only the single requested page is audited; links are not crawled."_                                                            |

Tiga kalimat lama tetap muncul — tetapi sekarang **diakibatkan oleh fakta**, bukan dinyatakan sebagai janji. Kalimat ketiga tidak dapat dihasilkan oleh v0.1.0 sama sekali, karena v0.1.0 tidak memiliki kemampuan menyadari kondisinya.

Reporters tetap tidak menghitung ulang apa pun: mereka membaca `result.limitations` seperti sebelumnya, sesuai prinsip `architecture.md:68`.

---

## 4. Kontrak data (perubahan)

```ts
// contracts/types.ts

export type ObservationSource = 'served-html' | 'rendered-dom' | 'http-headers'
export type NotInspected = 'rendered-dom' | 'linked-pages' | 'wcag-conformance' | 'exploitability'

export type RuleStatus =
  'passed' | 'failed' | 'needs-review' | 'not-applicable' | 'unobservable' | 'error'
export type EvaluatedStatus = Exclude<RuleStatus, 'unobservable' | 'error'>

export interface AuditSnapshot {
  // ...field yang sudah ada...
  rendering: RenderingAssessment // baru
}

export interface RuleDefinition {
  // ...field yang sudah ada...
  observation: ObservationSource // baru
}

export interface Finding extends FindingDraft {
  // ...field yang sudah ada...
  /**
   * Representasi asal finding ini. Report harus dapat dibaca tanpa
   * tabel pemetaan ruleId → observation dari versi PageScope tertentu.
   */
  observedFrom: ObservationSource // baru
}

export interface AuditCoverage {
  representation: 'served-html' | 'rendered-dom'
  rendering: 'server-rendered' | 'client-rendered'
  renderingEvidence: Evidence[]
  rulesEvaluated: number
  unobservableRules: string[]
  notInspected: NotInspected[]
}

export interface AuditResult {
  // ...field yang sudah ada...
  coverage: AuditCoverage // baru, wajib
  limitations: string[] // tetap ada, kini turunan
}
```

`representation` memuat `'rendered-dom'` yang belum dapat dihasilkan. Ini diterima secara sadar: Spec A akan mengisinya tanpa bump schema lagi, dan itulah alasan fase ini mendahului fase A.

---

## 5. Alur engine

Satu penyisipan di dalam loop rule, sebelum `appliesTo`:

```ts
// engine/audit.ts, di dalam `for (const rule of rules)`
const insufficient =
  rule.observation === 'rendered-dom' && snapshot.rendering.kind === 'client-rendered'

if (insufficient) {
  summaries.push({
    ruleId: rule.id,
    status: 'unobservable',
    findingCount: 0,
    note: `needs the rendered DOM; ${snapshot.rendering.reason}`,
  })
  continue
}
```

Tiga konsekuensi yang perlu dinyatakan:

1. **`evaluate` tidak dipanggil.** Rule `rendered-dom` yang akan `throw` pada snapshot client-rendered tetap menghasilkan `unobservable`, bukan `error`. Ini diuji secara eksplisit.
2. **`appliesTo` tidak dipanggil.** Status `not-applicable` tidak pernah muncul untuk rule `rendered-dom` pada halaman client-rendered — karena kita memang tidak berhak menyimpulkan subjeknya tidak ada.
3. **Rule `served-html` dan `http-headers` tidak tersentuh.** Delapan rule tetap dinilai normal pada halaman client-rendered, karena `<head>`, atribut `<html>`, dan header HTTP memang dikirim server.

`coverage` dirakit di akhir, dari snapshot dan dari `summaries`:

```ts
const coverage: AuditCoverage = {
  representation: 'served-html',
  rendering: snapshot.rendering.kind,
  renderingEvidence: snapshot.rendering.evidence,
  rulesEvaluated: summaries.filter((s) => s.status !== 'unobservable' && s.status !== 'error')
    .length,
  unobservableRules: summaries.filter((s) => s.status === 'unobservable').map((s) => s.ruleId),
  notInspected: ['rendered-dom', 'linked-pages', 'wcag-conformance', 'exploitability'],
}
```

Pada jalur kegagalan (`buildFailure`, `audit.ts:67-86`), `coverage` tetap wajib ada:

```ts
coverage: {
  representation: 'served-html',
  rendering: 'server-rendered',
  renderingEvidence: [],
  rulesEvaluated: 0,
  unobservableRules: [],
  notInspected: ['rendered-dom', 'linked-pages', 'wcag-conformance', 'exploitability'],
}
```

`rendering: 'server-rendered'` pada jalur ini bukan klaim — halaman tidak pernah dibaca, sehingga klaim apa pun akan salah. Alasannya: `status: 'failed'` sudah menyatakan bahwa tidak ada halaman yang dinilai, dan `rulesEvaluated: 0` menutup sisanya. Alternatif `'unknown'` ditolak karena akan menambah anggota union yang hanya terpakai di satu jalur.

---

## 6. Detail deteksi rendering

### 6.1 Konstanta root framework

```ts
const ROOT_IDS = new Set(['root', 'app', '__next', '__nuxt', '___gatsby'])
const ROOT_TAGS = new Set(['app-root'])
```

Daftar ini sengaja pendek dan hanya memuat identifier yang benar-benar dipakai framework, bukan tebakan. `react-root` dan `svelte` ditolak karena bukan `id` yang dipakai framework tersebut; menambahkannya akan menjadi evidence yang dikarang.

### 6.2 Aturan

- Sinyal A menyala bila elemen `id`-nya ada di `ROOT_IDS` **atau** `tagName`-nya ada di `ROOT_TAGS`, **dan** elemen itu tidak memiliki satu pun element child.
- Sinyal B menyala bila `<noscript>` memuat teks yang cocok dengan pola permintaan JavaScript.
- Bila keduanya menyala, `reason` menyebut keduanya dan `evidence` memuat kedua snippet.
- Bila tidak ada yang menyala, `kind: 'server-rendered'`, `evidence: []`, dan `reason` adalah kalimat netral yang tidak mengklaim apa pun.

### 6.3 Batasan yang harus ditulis di dokumen

Deteksi ini **tidak** mengenali:

- SPA yang merender ke dalam `<div id="root">` yang sudah berisi markup placeholder (mis. spinner) — tidak kosong, jadi tidak terdeteksi.
- Aplikasi yang memakai mount point tanpa `id` yang dikenal.
- Halaman yang merender konten ke elemen yang sudah ada (progressive enhancement).

Untuk semua kasus di atas, PageScope tetap berperilaku seperti v0.1.0. Ini dinyatakan di `README.md` dan di `docs/rules/a11y-img-alt.md`, karena pembaca berhak tahu di mana jaminan kejujuran ini berhenti.

---

## 7. Perubahan CLI & reporter

### 7.1 `cli/run.ts`

- Opsi baru `--min-confidence <high|medium|low>`, default `low`, dan `minConfidence` masuk ke `configSchema` (`cli/src/config.ts`) mengikuti pola `failOn` yang sudah ada.
- Nilai di luar `high|medium|low` → exit `2`.
- `policyFindings` menyaring `status === 'failed'` (§3.5).

### 7.2 `cli/output.ts`

Ringkasan terminal mendapat tiga tambahan:

```
  high     Missing <title> element (seo/title) [confidence: high]
  ...
  coverage: served-html (server-rendered) | 11/13 rules evaluated | not inspected: rendered-dom, linked-pages, wcag-conformance, exploitability
  gate: 2 failed findings below --min-confidence high were not counted
```

Baris `gate:` hanya muncul bila `--min-confidence` benar-benar mengecualikan sesuatu. Baris `coverage:` selalu muncul. Semua teks yang berasal dari halaman target melewati `sanitizeForTerminal`.

### 7.3 `reporters/markdown.ts` dan `reporters/html.ts`

Seksi `## Coverage` ditambahkan **sebelum** `## Limitations`, memuat `representation`, `rendering`, `rulesEvaluated`, daftar `unobservableRules`, dan `notInspected`. Reporter HTML tetap nol JavaScript dan tetap menyisipkan CSP `default-src 'none'`.

**Jalur injeksi baru:** `rendering.reason` dan `rendering.evidence` berasal dari halaman yang diaudit. Keduanya wajib melewati `escapeHtml` dan `sanitizeForTerminal` seperti teks target lainnya, dan ini diuji (§9).

---

## 8. Kompatibilitas & `SCHEMA_VERSION` 2.0.0

### 8.1 Inventaris perubahan yang mematahkan

| Perubahan                                                       | Jenis        | Konsumen terdampak                            |
| --------------------------------------------------------------- | ------------ | --------------------------------------------- |
| `RuleStatus` bertambah `'unobservable'`                         | enum         | `switch` exhaustive pada status               |
| `EvaluatedStatus` mengecualikan `'unobservable'`                | tipe         | rule kustom yang mengembalikan `unobservable` |
| `AuditResult.coverage` **wajib**                                | field baru   | pembaca report 1.1.0                          |
| `Finding.observedFrom` **wajib**                                | field baru   | idem                                          |
| `RuleDefinition.observation` **wajib**                          | field baru   | penulis rule kustom                           |
| ekspor `LIMITATIONS` dihapus                                    | API publik   | `import { LIMITATIONS }`                      |
| `--fail-on` tidak lagi menggagalkan build karena `needs-review` | **perilaku** | semua CI yang sudah ada                       |

`docs/architecture.md:54` menetapkan breaking = major, sehingga **`SCHEMA_VERSION = '2.0.0'`**. Kedua package belum terbit di npm, jadi biaya perubahan ini bagi pengguna adalah nol.

Perubahan perilaku baris terakhir membuat gate **lebih longgar**. Itu perbaikan bug, tetapi gate yang tiba-tiba longgar dapat meloloskan regresi nyata. Karena itu ia wajib diumumkan di `README.md` bagian perilaku `--fail-on`, dan baris `gate:` di ringkasan terminal membuatnya terlihat pada setiap run.

### 8.2 Yang **tidak** perlu migrasi

- **Format baseline tetap `version: 1`.** Provenance bukan identitas: `fingerprintOf(ruleId, discriminator)` tidak berubah, sehingga semua file baseline yang ada tetap sah.
- Konsekuensi yang benar: bila sebuah halaman berubah dari server-rendered menjadi client-rendered, finding `rendered-dom`-nya hilang dari report dan entri baseline-nya menjadi `stale`. Mekanisme itu sudah ada dan sudah dilaporkan di ringkasan.
- `baseline.schemaVersion` bertipe `z.string()`, sehingga baseline 1.1.0 tetap terbaca dan hanya ditulis ulang sebagai 2.0.0.

### 8.3 Catatan migrasi untuk penulis rule kustom

Ditulis di `docs/contributing/adding-a-rule.md`:

1. Tambahkan `observation` ke setiap rule. Bila ragu, `'served-html'` — dan bila rule membaca markup yang mungkin dibuat JavaScript, `'rendered-dom'`.
2. Ganti `LIMITATIONS` dengan `limitationsFor(result.coverage)`.
3. Tangani status `unobservable` di UI yang mengonsumsi report. UI yang mengabaikannya akan menampilkan halaman client-rendered secara kurang jujur, bukan lebih.

---

## 9. Strategi test

Batasan v0.1.0 tidak dilonggarkan: **tidak ada test yang mengakses internet.** Semua fixture berupa string HTML inline atau berkas di `packages/core/fixtures/`.

| Berkas                              | Status   | Yang dibuktikan                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/collection/rendering.test.ts` | **baru** | `#root` kosong, `#__next` kosong, `#___gatsby` kosong, `<app-root>` kosong, dan `<noscript>` menuntut JS masing-masing → `client-rendered` + evidence tidak kosong. **`#root` berisi anak → `server-rendered`** (anti-false-positive). `#root` kosong tanpa `id` dikenal → `server-rendered`. Halaman polos → `server-rendered`, `evidence: []`.                                                |
| `test/fixtures.test.ts`             | ubah     | `coverage.rendering === 'server-rendered'` untuk `index.html` dan `clean.html`. Penjaga regresi terhadap fixture nyata yang sudah ada.                                                                                                                                                                                                                                                          |
| `test/engine/audit.test.ts`         | ubah     | `unobservable` tidak pernah `passed` dan tidak punya finding; rule `rendered-dom` **tidak memanggil** `evaluate` saat client-rendered (rule yang akan `throw` tetap `unobservable`, bukan `error`); rule `served-html` tetap dinilai normal pada snapshot client-rendered; `limitations` sama dengan `limitationsFor(coverage)`. Assertion lama `toEqual([...LIMITATIONS])` diganti.            |
| `test/contracts/schema.test.ts`     | ubah     | schema **menolak** `unobservable` di `findings[]`; **menerima** `unobservable` di `rules[].status`; menolak result tanpa `coverage`; menolak finding tanpa `observedFrom`.                                                                                                                                                                                                                      |
| `test/engine/registry.test.ts`      | **baru** | setiap rule terdaftar mendeklarasikan `observation` yang merupakan salah satu dari tiga nilai sah. Mencegah rule baru lupa.                                                                                                                                                                                                                                                                     |
| `test/reporters/reporters.test.ts`  | ubah     | coverage tampil di ketiga format; `rendering.reason` dan evidence **di-escape** — jalur injeksi baru, karena teksnya berasal dari halaman target.                                                                                                                                                                                                                                               |
| `test/rules/a11y.test.ts`           | ubah     | `not-applicable` untuk halaman tanpa gambar **tidak berubah** pada snapshot server-rendered.                                                                                                                                                                                                                                                                                                    |
| `test/cli.test.ts`                  | ubah     | `needs-review` tidak menggagalkan gate; `--min-confidence high` mengecualikan finding `medium` (exit `0` + baris `gate:`); `--min-confidence high` tetap menggagalkan pada finding ber-confidence `high`; `--min-confidence low` (default) sama dengan perilaku setelah perbaikan bug; `--min-confidence bogus` → exit `2`; finding yang menjadi `unobservable` membuat entri baseline `stale`. |
| `scripts/generate-rule-docs.mjs`    | ubah     | daftar status ditambah `unobservable`; setiap dokumen rule menyatakan apakah ia membutuhkan rendered DOM. Regenerasi 13 berkas `docs/rules/*.md`.                                                                                                                                                                                                                                               |

### 9.1 Aturan baru untuk kontributor

Masuk ke `docs/contributing/adding-a-rule.md`:

> Setiap rule wajib mendeklarasikan `observation`. Memilih `'rendered-dom'` wajib disertai satu kalimat alasan di deskripsi rule. Pilihan itu berarti "tool ini akan menolak menyimpulkan pada halaman yang dirender klien", dan itu keputusan yang harus terlihat saat review.

### 9.2 Perintah verifikasi

```
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm build
```

Baseline saat spec ini ditulis: **145 test, 16 berkas, semuanya lulus** (diverifikasi 2026-11-03). Jumlah rule tetap 13, jadi assertion `toHaveLength(13)` di `test/engine/audit.test.ts` tidak berubah.

---

## 10. Berkas yang berubah

**Baru**

- `packages/core/src/collection/rendering.ts`
- `packages/core/src/engine/limits.ts` — `limitationsFor(coverage)`
- `packages/core/test/collection/rendering.test.ts`
- `packages/core/test/engine/registry.test.ts`
- `docs/superpowers/specs/2026-11-03-pagescope-claim-calibration-design.md`

**Diubah — core**

- `src/contracts/types.ts` — `ObservationSource`, `NotInspected`, `RuleStatus`, `EvaluatedStatus`, `RenderingAssessment`, `AuditCoverage`, field baru
- `src/contracts/report-schema.ts` — `SCHEMA_VERSION = '2.0.0'`, schema `coverage` dan `observedFrom`, enum status
- `src/collection/fetch.ts` — panggil `detectRendering`, isi `snapshot.rendering`
- `src/engine/audit.ts` — cabang `unobservable`, rakit `coverage`, hapus `LIMITATIONS`, panggil `limitationsFor`
- `src/rules/*.ts` — 13 penambahan `observation`
- `src/reporters/markdown.ts`, `src/reporters/html.ts` — seksi coverage
- `src/index.ts` — ekspor `limitationsFor`, `AuditCoverage`; hapus `LIMITATIONS`

**Diubah — CLI**

- `src/run.ts` — `--min-confidence`, filter status, aturan gate
- `src/config.ts` — `minConfidence`
- `src/output.ts` — confidence, baris `coverage:`, baris `gate:`

**Diubah — dokumentasi**

- `README.md` — Known limitations jadi tabel yang menunjuk `coverage.notInspected`; perilaku `--fail-on` dan `--min-confidence`
- `docs/architecture.md` — tabel status ditambah `unobservable`; seksi coverage/limitations
- `docs/contributing/adding-a-rule.md` — `observation` wajib, definisi `confidence`
- `CONTRIBUTING.md` — definisi `confidence`
- `scripts/generate-rule-docs.mjs` + regenerasi 13 `docs/rules/*.md`

---

## 11. Amandemen terhadap spec v1

Spec `2026-11-02-pagescope-design.md` tetap menjadi acuan untuk v0.1.0. Spec ini mengubahnya secara sadar di empat titik, dicatat agar kedua dokumen tetap jujur tentang keadaan sebenarnya.

### 11.1 §6.1 — model status bertambah satu anggota

Spec lama menetapkan lima status dan menyatakan `error` hanya di-set engine. Model baru menambah `unobservable` dengan aturan kepemilikan yang sama. Alasan: model lima status tidak memiliki sel untuk "tidak dapat diamati", dan kekosongan itu diisi `not-applicable`, yang artinya berbeda.

### 11.2 §7.2 — batas klaim tetap, tetapi kini ditegakkan mesin

Larangan menyatakan kepatuhan WCAG atau exploitability **tidak dilonggarkan**. Yang berubah: kepatuhan pada larangan itu sebagian dipindahkan dari prosa ke tipe dan status. `unobservable` membuat "kami tidak melihat cukup" menjadi keadaan yang harus dinyatakan, bukan pilihan yang bisa diabaikan rule.

### 11.3 §8.4 — batas sumber daya tidak berubah

Fase ini menambah satu lintasan atas dokumen yang sudah di-parse (`detectRendering`). Tidak ada request tambahan, tidak ada unduhan tambahan, tidak ada perubahan batas waktu, ukuran, atau konkurensi. Konkurensi tetap 1.

### 11.4 §15 — item roadmap yang dimajukan

Spec lama mencantumkan "desain fingerprint finding yang stabil" sebagai prasyarat `--baseline`; itu sudah selesai di v0.1.1. Fase C memajukan satu hal yang tidak ada di roadmap lama — pemisahan status observability — karena ia prasyarat bagi fase B dan A.

---

## 12. Non-goals — yang secara eksplisit TIDAK dikerjakan

Bagian ini ada supaya fase berikutnya tidak mengklaim hal-hal ini sudah selesai.

| Hal                                                 | Alasan ditolak                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Menjalankan JavaScript / browser                    | Itu fase A. Fase C hanya berhenti berpura-pura tentang ketiadaannya.                                                     |
| Crawling beberapa halaman                           | Itu fase B. `notInspected` tetap memuat `'linked-pages'`.                                                                |
| Rule baru                                           | Jumlah rule tetap 13. Membuka fase kontrak bersamaan dengan fase rule membuat keduanya sulit di-review.                  |
| Klaim WCAG atau exploitability dalam bentuk apa pun | Dilarang oleh spec v1 §7.2 dan tetap dilarang. `notInspected` selalu memuat `'wcag-conformance'` dan `'exploitability'`. |
| Menurunkan severity berdasarkan confidence          | Dua dimensi independen tidak boleh saling menimpa. Gate membaca keduanya secara terpisah (§3.5).                         |
| Heuristik rendering berbasis ambang jumlah elemen   | Ditolak: ambang angka adalah evidence yang dikarang.                                                                     |
| Akses ke `localhost` / jaringan privat              | Tidak berubah. `allowPrivateNetworks` tetap internal.                                                                    |

---

## 13. Risiko terbuka

| #   | Risiko                                                                                                  | Mitigasi                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Deteksi melewatkan SPA yang mount point-nya berisi placeholder, sehingga lulus palsu tetap terjadi      | Dinyatakan eksplisit di `README.md` dan `docs/rules/a11y-img-alt.md` §"What this rule does not check". Recall rendah adalah pilihan sadar, bukan cacat tersembunyi.            |
| 2   | Deteksi salah menandai halaman normal sebagai client-rendered, menurunkan 2 rule menjadi `unobservable` | Dua sinyal berpresisi tinggi tanpa ambang; `fixtures.test.ts` mengunci kedua fixture nyata sebagai `server-rendered`; test anti-false-positive untuk `#root` yang berisi anak. |
| 3   | Gate menjadi lebih longgar dan meloloskan regresi nyata                                                 | Diperlakukan sebagai perubahan perilaku yang diumumkan, bukan perbaikan senyap. Baris `gate:` di ringkasan membuatnya terlihat pada setiap run.                                |
| 4   | `rendering.reason` menjadi jalur injeksi HTML/terminal baru                                             | Teks berasal dari halaman target. Wajib melewati `escapeHtml`/`sanitizeForTerminal`, diuji di `reporters.test.ts`.                                                             |
| 5   | Cakupan perubahan besar untuk satu fase                                                                 | Seam-nya sudah ada (`appliesTo` → `evaluate`, reporter membaca result). Mayoritas perubahan bersifat menambah field. Tidak ada rule yang ditulis ulang.                        |
| 6   | `observation` sebagai field wajib memaksa penulis rule kustom mengubah kode                             | Diterima dan didokumentasikan (§8.3). Alternatifnya — field opsional dengan default — akan menyembunyikan keputusan yang justru ingin terlihat.                                |

---

## 14. Kriteria selesai

Fase C dinyatakan selesai bila **semua** berikut benar:

- [ ] Halaman client-rendered melaporkan `unobservable` untuk `a11y/img-alt` dan `seo/heading-structure`, dan **tidak** `not-applicable` atau `passed`
- [ ] Halaman server-rendered tanpa gambar tetap melaporkan `not-applicable` untuk `a11y/img-alt` (perilaku v0.1.0 tidak berubah)
- [ ] Delapan rule `served-html` dan tiga rule `http-headers` menghasilkan status yang sama pada halaman client-rendered maupun server-rendered
- [ ] `unobservable` tidak pernah muncul sebagai `passed`, dan tidak pernah membawa finding
- [ ] `RuleResult.status` bertipe `EvaluatedStatus`, sehingga `unobservable` tidak dapat dikembalikan rule — ditegakkan compiler
- [ ] Setiap `AuditResult` memuat `coverage`, termasuk pada jalur kegagalan
- [ ] Setiap `Finding` memuat `observedFrom`
- [ ] `result.limitations` selalu sama dengan `limitationsFor(result.coverage)`
- [ ] Laporan client-rendered memuat kalimat limitation yang tidak mungkin dihasilkan v0.1.0
- [ ] `--fail-on high` tidak menggagalkan build karena finding berstatus `needs-review`
- [ ] `--min-confidence high` mengecualikan finding ber-confidence `medium` dari gate, dan ringkasan memuat baris `gate:`
- [ ] `--min-confidence` default `low` tidak mengubah hasil gate selain karena perbaikan bug §2.3
- [ ] `confidence` tampil di ringkasan terminal
- [ ] File baseline `version: 1` yang sudah ada tetap terbaca dan tetap berlaku
- [ ] `SCHEMA_VERSION === '2.0.0'`, dan report 1.1.0 tidak lagi memvalidasi
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, `pnpm build` semuanya lulus
- [ ] Tidak ada test yang mengakses internet
- [ ] Jumlah rule tetap 13

---

## 15. Urutan fase setelah C

| Fase  | Item                                          | Prasyarat yang dipenuhi oleh fase ini                                                                                                                      |
| ----- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B** | Crawling multi-halaman                        | `coverage` siap menampung dimensi per-halaman; `notInspected` siap kehilangan `'linked-pages'`; `unobservable` siap menyatakan halaman yang tidak di-crawl |
| **A** | Browser / rendered-DOM sebagai package ketiga | `representation` siap berisi `'rendered-dom'`; `observation` per rule sudah menjadi kontrak; `observedFrom` sudah ada di setiap finding                    |

Fase A tetap mengubah model ancaman (`threat-model.md`: _"Pages are never rendered, so no script from the audited origin ever executes in this process"_), sehingga ia memerlukan dokumen ancaman sendiri, bukan tambahan pada dokumen ini.
