# KAMERA OPTOM QARSHI — Professional Xavfsizlik va Videokuzatuv Platformasi

Qarshi shahri va butun O'zbekiston bo'ylab videokuzatuv kameralari, videoregistratorlar, xotira kartalari va xavfsizlik tizimlarini optom narxlarda savdo qilish, komplekt hisoblash va o'rnatish xizmatlarini boshqarish tizimi.

---

## 📁 Loyiha tuzilishi

- `app.html` — Mijoz mobil web-ilovasi, **"Signal" dizayni** (`/app` manzilida): bento bosh sahifa va illuziyaviy animatsiyalar, asosiy kataloglar → saralash, aqlli komplekt yordamchisi, mutaxassis arizasi, savat, buyurtmalarim, usta arizasi va 3 til (o'zbek lotin / кирилл / русский). Yorug' qog'oz fon, siyoh-qora tugmalar, to'q sariq aksent, Unbounded + Onest shriftlari, SVG ikonkalar, suzuvchi navigatsiya, kunduzgi/tungi mavzu.
- **Narx dvigateli** (`backend/src/currency.js`): mahsulotning `price_usd` — dollardagi tannarx; sotuv narxi = tannarx × kurs × (1 + marja). Standart marja 15 %, tasdiqlangan ustalar uchun 12 %, har bir tovarga alohida marja qo'yish mumkin. Kurs/marjalar Admin → Sozlamalar → «Narxlar: dollar kursi va marja» dan oldindan ko'rish bilan qo'llanadi (CBU kursini olish tugmasi bor).
- **Ishlarimiz videolari**: mijoz videoga layk bosadi, izoh yozadi va ulashadi (akkauntsiz — qurilma identifikatori bilan). Izohlar Admin → Stories bo'limida moderatsiya qilinadi (yashirish / o'chirish).
- **Maxfiy narxlar**: import qilingan xususiyatlardagi diler (optom) va chakana narx qatorlari mijoz API'sidan olib tashlanadi — faqat adminda ko'rinadi.
- **Ustalar**: mijoz ilovasi Profil → «Usta bo'lish» — o'rnatgan kameralari rasmlari bilan ariza; Admin → Ustalar bo'limida tasdiqlanadi. Tasdiqlangan raqamga ilova va buyurtmalar usta narxida.
- `admin.html` — **Admin 2.0** boshqaruv paneli (`/admin` manzilida): buyurtmalar, arizalar, ombor qoldig'i, dollar kursi va marjalar, ustalar, muddatli to'lov sozlamalari, stories/bannerlar, KPI va tizim sozlamalari.
- `backend/` — Node.js REST API serveri:
  - `src/server.js` — Asosiy Express serveri.
  - `src/db.js` — SQLite ma'lumotlar bazasi (WAL rejimi).
  - `src/auth.js` — JWT va parollarni scrypt bilan xeshlash.
  - `src/reset-admin.js` — Admin parolini xavfsiz tiklash CLI skripti.
  - `src/routes/` — API marshrutlari (`products`, `orders`, `callbacks`, `admin`, `config`, `stories`, `banners`).
- `test-smoke.js` — Brauzersiz sintaksis, xavfsizlik va reaktivlik smoke-testlari.

---

## 🚀 Ishga tushirish

### 1. Talablar
- **Node.js**: v20+ (tavsiya etiladi: v22+ yoki v24+)
- **NPM**: Node.js bilan birga keladi

### 2. Sozlash (.env)
`backend` papkasidagi konfiguratsiya namunasidan nusxa oling:
```bash
cp backend/.env.example backend/.env
```

`.env` fayl parametrlari:
```env
PORT=3000
JWT_SECRET=<64-belgili tasodifiy satr — openssl rand -hex 32>
ADMIN_PASSWORD=<kuchli parol o'rnating>
```

### 3. Bog'liqliklarni o'rnatish
```bash
cd backend
npm install
```

### 4. Admin parolini tiklash
Admin parolini `.env` dagi `ADMIN_PASSWORD` ga o'rnatish:
```bash
npm run admin:reset
```
Yoki maxsus parol bilan:
```bash
node src/reset-admin.js YangiParol123!
```

### 5. Serverni yurgizish
```bash
npm start
```
Server standart `http://localhost:3000` portida ishga tushadi:
- Mijoz ilovasi: `http://localhost:3000/app`
- Admin panel: `http://localhost:3000/admin`
- API bazasi: `http://localhost:3000/api/...`

---

## 🧪 Sinov (Smoke Test)

Loyihadagi barcha frontend renderlari, localStorage sinxronizatsiyasi, qidiruv transliteratsiyasi va API routerlarini tekshirish:
```bash
node test-smoke.js
```

---

## 🔒 Xavfsizlik xususiyatlari

- **JWT Himoyasi**: Barcha admin API so'rovlari `Authorization: Bearer <token>` orqali tekshiriladi.
- **Login Rate-Limiting**: Admin login urinishlariga IP bo'yicha cheklov qo'yilgan (1 daqiqada max 10 ta noto'g'ri urinish).
- **Yopilgan Buyurtma Himoyasi**: Yopilgan buyurtmalarni o'zgartirishdan oldin tasdiqlash talab etiladi.
- **Xotira va Savat Sanitizatsiyasi**: Buyurtmadagi tovarlar va xotira SKU lari qat'iy tekshiriladi.
