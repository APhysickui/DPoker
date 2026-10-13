# Visual direction — The Good Company Club

References studied: [House of Yellow](https://houseofyellow.nl/) for oversized typography and emphatic pacing; [Rosso, via MUUUUU](https://muuuuu.org/zh/industry/technology/25048.html) for animated, spatial graphic studies. Reference sites' images and source code are not bundled in this project.

DPoker uses paper white, electric blue, condensed display type and an original CSS/SVG playing-card sculpture. The live table changes to midnight blue with pale-blue action accents. Invitations skip the large landing composition and lead straight to joining. The moving ribbon and pointer-following card sculpture are decorative; pausing them does not pause a hand or hide dealt cards.

- Self-hosted fonts: Barlow Condensed 700, Manrope 400/600 and Instrument Serif Italic, distributed by Fontsource. License copies are in `public/fonts/`.
- Motion: staggered headline entrance, floating cards/chip, pointer tilt, ribbon, card entrance and turn indicator. The header control pauses decoration; `prefers-reduced-motion` disables motion. No scroll hijacking or external animation runtime.
- Responsive checks: 320/390/768/1440px, including nine seats and inward-positioned betting amounts.
- Browser QA: `scripts/design_capture.py`, `scripts/design_interaction_test.py`, `scripts/browser_table_test.py`, and `scripts/review_browser_test.py`. Local screenshots: `artifacts/design/`.

The companion QPDS identity uses the same typography with charcoal, acid-lime accents, an original animated contour study and a light analysis workspace.
