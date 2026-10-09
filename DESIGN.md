# MangoPOS — Design System

Design reference for building the MangoPOS interface. Derived from the **MangoLabs Brand Guide** (source of truth: `../Brand Guide`, a raster PNG; text form in `../tmp/pdfs/build_detailed_brand_guide.py`).

> Brand assets live outside this repo at `../output/brand-variations/`. Copy the ones you need into the app's static assets before referencing them from code.

---

## 1. Brand foundation

| Field | Value |
|---|---|
| Company | **MangoLabs** |
| Product | **MangoPOS** |
| Tagline | *We build software that grows your ideas.* |
| Description | Mangolabs is a software development company focused on building scalable, reliable and beautiful digital solutions. |
| Brand idea | *Creative. Innovative. Reliable.* |

The mango and its leaf are the core symbol: growth, colour and craft. The mark pairs a mango body with a leaf accent.

---

## 2. Logo system

Three lockups. Pick the one that fits the space — never stretch or rebuild.

| Lockup | Use |
|---|---|
| **Primary** (horizontal) | Default. Headers, site nav, email, most layouts. |
| **Stacked** | Square-ish containers, splash/match screens, centred hero. |
| **Mango mark** (symbol only) | App icons, favicons, avatars, tight UI. |

**Clear space:** X = the height of the mango leaf. Keep X of empty space on every side.

**Minimum size:** 120 px wide (digital) · 24 mm wide (print).

**Approved variants:** full colour, monochrome black, monochrome white, compact (icon + wordmark).

**Do not**
- Recolour outside the approved variants, or apply gradients/effects/shadows.
- Rotate, skew, stretch, or outline the mark.
- Place full-colour art on a busy or low-contrast background — use the white/black monochrome variants there.
- Recreate the logo in code with stock fonts or emoji.

---

## 3. Colour palette

### Primary
| Token | Hex | Role |
|---|---|---|
| Navy | `#0D182A` | Primary dark surface / brand anchor |
| Orange | `#FF6D00` | Primary action / highlights |
| Mango | `#FFB100` | Brand accent / primary CTA |
| Green | `#27AE60` | Success / positive |

### Secondary
| Token | Hex |
|---|---|
| Gold | `#F5A623` |
| Mint | `#2ECC71` |
| Blue | `#3498DB` |
| Purple | `#8E44AD` |
| Mist | `#EAEFF6` |

### Neutrals
| Token | Hex | Role |
|---|---|---|
| Ink | `#111D34` | Body text |
| Muted | `#526071` | Secondary text |
| Line | `#DDE3EA` | Borders / dividers |
| Paper | `#F7F8FA` | App background |

### Status
| Token | Hex | Role |
|---|---|---|
| Green | `#27AE60` | Success |
| Red | `#E74C3C` | Error / destructive (void, delete) |
| Blue | `#3498DB` | Info |
| Orange | `#FF6D00` | Warning |

**Usage rules**
- Text/background pairs must meet WCAG AA (4.5:1 body, 3:1 large text). Navy/Ink on Paper/white and white on Navy are safe. **Never white text on Mango (`#FFB100`) or Green — contrast is insufficient.**
- Mango/Orange are accents, not large flat backgrounds.
- Red is reserved for destructive actions and errors only.

---

## 4. Typography

Typeface: **Poppins** (Google Fonts).

| Weight | Use |
|---|---|
| Poppins **Bold (700)** | Headlines, titles, numbers |
| Poppins **Medium (500)** | Subheads, nav, buttons, labels |
| Poppins **Regular (400)** | Body copy |

Fallback stack: `'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif`

Suggested scale (rem, base 16): 2.5 / 2 / 1.5 / 1.25 / 1 / 0.875. Body line-height 1.5, headings 1.2.

---

## 5. Iconography

Simple line icons, rounded corners/joins, consistent stroke weight. Base in Navy with a single Mango/Orange/Green accent. Use one icon family throughout — do not mix filled and outline sets.

---

## 6. Design tokens (CSS)

```css
:root {
  /* Brand */
  --color-navy:   #0D182A;
  --color-ink:    #111D34;
  --color-muted:  #526071;
  --color-line:   #DDE3EA;
  --color-paper:  #F7F8FA;
  --color-orange: #FF6D00;
  --color-mango:  #FFB100;
  --color-green:  #27AE60;
  --color-red:    #E74C3C;
  --color-blue:   #3498DB;
  --color-purple: #8E44AD;
  --color-gold:   #F5A623;
  --color-mint:   #2ECC71;
  --color-mist:   #EAEFF6;

  /* Semantic */
  --bg-app:     var(--color-paper);
  --text-body:  var(--color-ink);
  --text-muted: var(--color-muted);
  --border:     var(--color-line);
  --action:     var(--color-orange);
  --action-alt: var(--color-mango);
  --success:    var(--color-green);
  --danger:     var(--color-red);

  /* Type */
  --font-sans: 'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --weight-regular: 400;
  --weight-medium:  500;
  --weight-bold:    700;

  /* Space / shape */
  --space-unit: 4px;
  --radius:     8px;
}
```

---

## 7. Asset inventory

Source: `../output/brand-variations/` (PNGs in `png/`, SVGs in `svg/`).

| Name | Description | Size (px) |
|---|---|---|
| `primary-logo` | Primary horizontal logo | 188 × 61 |
| `stacked-logo` | Stacked logo | 116 × 95 |
| `logo-mark-icon` | Standalone logo mark | 55 × 68 |
| `full-color-light` | Full-colour, light backgrounds | 182 × 73 |
| `monochrome-black` | Monochrome black | 165 × 70 |
| `monochrome-white` | Monochrome white | 187 × 117 |
| `wordmark-only` | Wordmark only | 124 × 47 |
| `compact-icon-wordmark` | Compact icon + wordmark | 152 × 56 |
| `small-favicon` | Small favicon mark | 45 × 58 |
| `app-icon-navy` | Navy rounded app icon | 82 × 85 |
| `app-icon-white` | White rounded app icon | 77 × 89 |
| `social-icon-navy` | Navy circular social icon | 83 × 87 |
| `social-icon-mango` | Mango circular social icon | 67 × 87 |
| `social-icon-green` | Green circular social icon | 86 × 87 |

**Gotcha:** the SVGs are self-contained but **embed the source PNG — they are not editable vector paths.** Do not treat them as scalable vector originals; request vector source if true vector is needed.

Reference PDFs: `../output/pdf/mangolabs-brand-guide.pdf`, `mangolabs-brand-guide-detailed.pdf`.

---

## 8. Applying this to MangoPOS

Still on the legacy PoopPOS identity and must be replaced:

- `index.html` — `<title>` is *"PoopPOS - Sistema de Control Todo en Uno para Pequeños Negocios"*; logo `alt` is *"PoopPOS logo"* referencing `images/logos.png`. Swap to the MangoPOS name and `primary-logo` / `compact-icon-wordmark`.
- `version.json` — still the legacy *"v 1.0.7 / EPIC UPDATE"* payload.
- Favicon / app icons — use `small-favicon`, `app-icon-navy`.
- `style.css` — replace ad-hoc colours with the tokens in §6; load Poppins.

Package identity is already renamed (`mangopos`, `@mangolabs/mangopos-api`, `@mangolabs/mangopos-docs`).
