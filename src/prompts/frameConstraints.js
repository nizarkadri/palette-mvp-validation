export const SINGLE_FRAME_RECONSTRUCTION_RULES = `SINGLE-FRAME FIT CONTRACT
- Treat the uploaded image as one non-scrollable captured frame, regardless of whether the source product is a website, dashboard, or mobile app.
- Recreate only the UI visible in that captured frame; do not build content that would require scrolling to see.
- Put the entire reconstruction inside one root <div class="s2c-screen">...</div> and make all visible content fit within that parent.
- Do not rely on document/body scrolling, internal scroll containers, sticky/fixed positioning, or content outside .s2c-screen to reveal parts of the UI.
- If the real product would scroll, represent only the visible viewport as a static layout inside .s2c-screen.`;
