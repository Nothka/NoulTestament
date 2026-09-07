# Noul Testament

Website React pentru citirea traducerii Noului Testament.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Lățimea textului

Pasajele se citesc într-o singură coloană, centrată, cu notele sub fiecare pasaj.
În `/edit`, controlul **Lățime coloană** ajustează imediat lățimea pe întregul site.
Butonul **↺** revine la lățimea standard, iar **Publică** salvează alegerea pentru cititori.
Modificarea se păstrează la reîncărcare și poate fi anulată din **Modificări**.
Pe telefon, coloana se adaptează la spațiul disponibil.

## Netlify

Build command: `npm run build`

Publish directory: `dist`

Configurația este în `netlify.toml`.
