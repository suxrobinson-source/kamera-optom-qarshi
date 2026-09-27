# KAMERA OPTOM QARSHI — Backend

Mijoz ilovasi va admin panel uchun REST API. Prototip: `../Kuzatuv Kamera Savdo.dc.html`.

**Stack:** Node.js (≥22.5) · Express · SQLite (Node ichki `node:sqlite` — tashqi native kutubxona yo'q) · JWT.

## Ishga tushirish

1. Muhit parametrlarini o'rnatish:
```powershell
cp .env.example .env
# .env faylida kuchli JWT_SECRET va ADMIN_PASSWORD o'rnating
```

2. Qaramliklarni o'rnatish va parolni yangilash:
```powershell
cd backend
npm install
npm run admin:reset                # Admin parolini .env dagi qiymatga yangilash
npm start                          # http://localhost:3000
```

Birinchi ishga tushishda baza avtomatik yaratiladi va prototipdagi ma'lumotlar bilan to'ldiriladi
(14 mahsulot, 7 kategoriya, 3 banner, 5 o'rnatish keysi, 28 hudud, kredit stavkalari).
Qayta seed: `npm run seed -- --force`.

Muhit o'zgaruvchilari: `PORT` (default 3000), `ADMIN_PASSWORD`, `JWT_SECRET`.

## API

### Ochiq endpointlar

| Endpoint | Tavsif |
|---|---|
| `GET /api/health` | Server holati |
| `GET /api/products` | Katalog. Filtrlar: `cat`, `poe=1`, `mp=1`, `night=1`, `min`, `max`, `q`, `sort` (price-asc / price-desc / new) |
| `GET /api/products/:sku` | Bitta mahsulot (spec jadvali bilan) |
| `GET /api/categories` | Kategoriyalar + mahsulot soni |
| `GET /api/banners` | Faol bannerlar (fon rasmi `image` maydonida) |
| `GET /api/stories` | O'rnatish keyslari ("stories") |
| `GET /api/regions` | Yetkazish hududlari (narx, muddat, zona) |
| `GET /api/config` | Kredit stavkalari, kalkulyator narxlari, modul flaglari, status oqimi |
| `POST /api/kit/calc` | Komplekt kalkulyatori — tarkib bo'yicha jami summa + muddatli to'lov variantlari |
| `POST /api/orders` | Buyurtma yaratish (summa serverda hisoblanadi, ombor qoldig'i tekshiriladi va kamayadi) |
| `GET /api/orders?phone=...` | Mijoz buyurtmalari |
| `GET /api/orders/:id?phone=...` | Bitta buyurtma + status tarixi |
| `POST /api/callbacks` | Qo'ng'iroq / mutaxassis so'rovi |

`POST /api/orders` misoli:

```json
{
  "phone": "901234567",
  "clientName": "Aziz Karimov",
  "region": "Qarshi shahri",
  "address": "Mustaqillik ko'chasi 12",
  "items": [{ "sku": "IPC-2410", "qty": 4 }, { "sku": "NVR-8CH", "qty": 1 }],
  "install": true,
  "cloud": false
}
```

### Admin endpointlar (`Authorization: Bearer <token>`)

| Endpoint | Tavsif |
|---|---|
| `POST /api/admin/login` | `{username, password}` → JWT token (12 soat) |
| `GET /api/admin/orders` | Barcha buyurtmalar (`status`, `q` filtrlari) |
| `PATCH /api/admin/orders/:id/status` | Statusni o'tkazish. Bo'sh body → keyingi bosqich: Yangi → Tasdiqlandi → O'rnatishda → Yopildi. `{"status":"Bekor"}` — bekor (qoldiq qaytadi) |
| `PATCH /api/admin/orders/:id` | Izoh (`note`) va o'rnatish sanasi (`install_at`) |
| `GET /api/admin/schedule` | O'rnatish jadvali |
| `GET /api/admin/stock` | Ombor (qoldiq < 10 → `low: true`) |
| `PATCH /api/admin/products/:sku` | Narx, qoldiq, promo yorlig'i (HIT/CHEGIRMA/YANGI), faollik |
| `POST /api/admin/products` | Yangi mahsulot |
| `GET /api/admin/kpis` | KPI: bugungi buyurtmalar/tushum, ochiq buyurtmalar, o'rnatishda, kam qoldiq, yangi qo'ng'iroqlar |
| `GET /api/admin/callbacks` · `PATCH /api/admin/callbacks/:id` | Qo'ng'iroq so'rovlari |
| `GET/PATCH /api/admin/settings/:key` | `pricing` / `credit` / `modules` sozlamalari |
| `GET/POST/PATCH/DELETE /api/admin/banners` | Bannerlar CRUD |

## Banner fonlari

`assets/banners/` — ilovaning "nazorat xonasi" uslubidagi SVG fonlar (banner-kit, banner-credit, banner-expert).
Ko'rish: server ishlayotganda <http://localhost:3000/assets/banners/preview.html>.

## Tuzilma

```
backend/
  src/
    server.js        # Express ilova, marshrutlar ulanishi
    db.js            # SQLite sxema (node:sqlite)
    seed.js          # Prototip ma'lumotlari bilan to'ldirish + admin yaratish
    auth.js          # JWT login / requireAdmin middleware
    routes/
      public.js      # Katalog, konfig, kalkulyator
      orders.js      # Buyurtma va qo'ng'iroqlar
      admin.js       # Admin panel API
  assets/banners/    # SVG banner fonlari + preview.html
  data/kamera.db     # SQLite baza (avtomatik yaratiladi)
```
