# KAMERA OPTOM QARSHI — Professional Xavfsizlik va Videokuzatuv Platformasi

Qarshi shahri va butun O'zbekiston bo'ylab videokuzatuv kameralari, videoregistratorlar, xotira kartalari va xavfsizlik tizimlarini optom narxlarda savdo qilish, komplekt hisoblash va o'rnatish xizmatlarini boshqarish tizimi.

---

## 📁 Loyiha tuzilishi

- `app.html` — Mijoz mobil web-ilovasi (katalog, 360° ko'rish, komplekt kalkulyatori, mutaxassis arizasi, savat, buyurtmalarim va bildirishnomalar).
- `admin.html` — Admin boshqaruv paneli (buyurtmalar, arizalar, ombor qoldig'i, muddatli to'lov sozlamalari, stories/bannerlar, KPI va tizim sozlamalari).
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
JWT_SECRET=super_secret_jwt_key_kamera_optom_qarshi_2026
ADMIN_PASSWORD=admin
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
- Mijoz ilovasi: `http://localhost:3000/app` yoki `app.html`
- Admin panel: `http://localhost:3000/admin` yoki `admin.html`
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
