# Plugin: curated font dropdown on the lower third (spec, 2026-07-30)

**Decision (Javi, revised):** the picker lives in the **QuickVid panel**, not in
Premiere's Properties. The existing "Position" accordion becomes **Advanced
settings** with two groups, **Position** and **Font**; the pill reads
**off-standard**; the duplicate warning inside is deleted. Font is **Raleway
(OCHA)** by default and **Bebas Neue (UN videos)** as the alternative. No change
to any default — someone who never opens the accordion gets today's product.

**Font source: Google's Bebas Neue** (OFL, single weight), not Bebas Neue Pro.
Reason: it is redistributable, so the **web app can bundle it too** and the two
products keep one typography story. Single weight is not a loss — the lower third
already separates name from title by size, colour and box, not by weight.
Bundle it beside the others in `engine/assets/fonts/` when the web app needs it.

*(Terminology: Adobe renamed Essential Graphics to **Properties**. Our dev READMEs
still say the old name — worth a sweep.)*

---

## Why this is low-risk: the mechanism is already in production

The thing that would normally need proving — *can an exposed Source Text property
carry an expression AND still be written by the panel?* — is already answered by
the shipping plugin:

| | Where |
|---|---|
| Source Text has an expression | `builder_template.jsx:353` — `('' + value).toUpperCase()` |
| …the same property is exposed to Properties | `:471` — `addEGP(… "ADBE Text Document", comp, "Name")` |
| …and the panel writes to it | `host.jsx` — `properties[i].setValue(str, true)` |

All three coexist today on the LT name. The font dropdown is the same pattern with
a bigger expression. **No spike needed for the core question.**

## What changes visually

Nothing except the typeface and capitalization. Confirmed against Javi's UN SG
reference: the colours are **already identical** —

| | brand-lt.json | UN SG reference |
|---|---|---|
| Name box / text | `#FFFFFF` / `#000000` | white box, black text |
| Title box / text | `#009EDB` / `#FFFFFF` | UN Blue box, white text |

Geometry, timing, animation, safe areas, the click, the box auto-sizing: all
untouched. The OCHA lower third and the UN SG lower third are the same design in
two typefaces.

## Build

**1. Dropdown control**, on the existing controller layer:

```
1  Raleway (OCHA)        <- default, index 1
2  Bebas (UN videos)
```

Exposed to Properties **last in the list** so it sits at the bottom, and labelled
so it reads as advanced.

**2. Source Text expression** replaces today's uppercase-only one. It must return
a **TextDocument**, not a String — today's returns a String, which is why it can
only change the text and not the styling:

```
var t = value;                                  // TextDocument, carries what the panel typed
if (effect("Font")("Menu") == 2) {              // Bebas
  t.font = "BebasNeue-Regular";                 // BOTH lines: it is a single-weight family
  t.text = ('' + t.text).toUpperCase();         // both lines uppercase, per the reference
} else if (LT.uppercase_name) {
  t.text = ('' + t.text).toUpperCase();         // today's behaviour, name only
}
t;
```

- **One face for both lines** — `BebasNeue-Regular`. Google's Bebas Neue is
  single-weight, so name and organisation share it and separate by size, colour
  and box, which the design already does. (Bebas Neue **Pro** has a Bold, but it
  is Adobe Fonts only and cannot be bundled with the web app — see the decision
  above.)
- Uppercase: today only the name is uppercased. In Bebas **both** lines are, to
  match the reference.
- **The font must be installed** for AE to bake it and for editors to see it.
  Google Bebas Neue is a free download; it is NOT on this Mac yet (only Bebas Neue
  Pro, via Adobe Fonts). Installing it is a prerequisite for the AE build.

**3. Per-font vertical metrics.** The only real design work. The box *width* looks
after itself (`sourceRectAtTime` drives it, so a narrower face reflows correctly),
but band height and baseline come from sizes baked at build time, and Bebas has a
much taller cap height relative to its em. Expect to tune the two sizes and the
vertical offset per font, driven off the same dropdown index.

**4. Scope.** Lower third only, all 4 formats. Location pin and Text on screen
stay Raleway — one display face per clip.

## Open question: resolved

The panel drives the control, so **grouping inside Properties no longer
matters**. Note the control must still be *exposed* on the template for
`getMGTComponent().properties` to reach it, so it will also appear as a plain
row in Properties — exactly as Position X/Y and Size already do.

## Requirement to confirm

Setting TextDocument attributes *from an expression* needs **After Effects 2020
(17.0) or newer**. If the AE in use is older, the fallback is two text layers per
role with opacity driven by the dropdown — cruder, more layers, no version
dependency.

## Not in scope

**Arabic.** Not a font entry: the plugin has no RTL handling at all (verified
2026-07-30 — nothing in the CEP panel or the AE builder), and After Effects on the
Latin build mis-renders Arabic outright. Its own project.

## Release shape

This regenerates the 4 lower-third templates, so it is an **After Effects build**
plus a new signed `.zxp` — a heavier release than the last few. Version, build and
ship only on Javi's explicit go.
