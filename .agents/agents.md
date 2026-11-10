# PoopPOS Web - Landing Page

## Descripción
Landing page estática para promocionar PoopPOS, un sistema POS de escritorio.

## Tech Stack
- **HTML5** - Single page
- **Tailwind CSS** - CDN (`cdn.tailwindcss.com`)
- **Google Fonts Inter** - CDN
- **Vanilla JS** - Animaciones, menú mobile, scroll effects
- **SVG** - Favicon/icon

## Estructura
```
/
├── index.html          # Landing page (único archivo)
├── style.css           # Vacío (placeholder)
├── icon.svg            # Favicon 1080x1080
├── version.json        # Versión app desktop
├── devmessage.json     # Test mensajes dev
├── images/
│   ├── login.png
│   ├── logos.png
│   └── main-dashboard.png
└── .agents/
    ├── gg.md           # Reglas dev
    ├── agents.md       # Este archivo
    ├── db.md           # Estructura DB
    └── map.md          # Pantallas y flujo
```

## Enlaces externos
- **Descarga app**: `https://geraldglitch.itch.io/pooppos`
- **Tutorial YouTube**: `https://www.youtube.com/embed/DcoOU_vywM8`

## Notas
- Sin build tools, sin package.json, sin backend
- Hosteable como archivos estáticos (GitHub Pages, cualquier static server)
- App desktop real NO está en este repo

## Rebuild MangoPOS (monorepo NestJS + Supabase)

El rebuild convive con la landing en este mismo repo:

- `apps/api` — API NestJS (auth, auditoría, reportes, diagnóstico).
- `apps/rebuild-docs` — documentación Docusaurus, fuente de verdad de operaciones.
- `supabase/migrations` — esquema Postgres/Supabase.
- `docker-compose.yml` + `supabase start` — stack local; dos orquestadores a propósito
  (Supabase dueña de la base, Compose dueño solo de la API).

Autenticación: Supabase Auth es el proveedor de identidad. Un empleado entra con
email/password o con business slug + PIN; el PIN es solo un lookup (se guarda como
`HMAC-SHA256(pin, PIN_PEPPER)`), nunca la contraseña. Las sesiones son JWT con los
claims `user_id`, `business_id`, `app_role` y `active`, agregados por
`custom_access_token_hook`. La recuperación usa el flujo de email integrado.
Referencia: `apps/rebuild-docs/docs/operations/api.md`.
