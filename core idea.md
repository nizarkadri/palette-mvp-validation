# Core Idea — UI Palette Explorer

**UI Palette Explorer lets someone upload a screenshot of an existing app or website UI, then rapidly explore different color palettes on that recreated UI without manually rebuilding or tagging the design.**

It is essentially **Coolors, but applied to the user's own real UI screenshot instead of abstract color swatches**.

## Core Flow

1. User uploads a screenshot of an app or website.
2. AI analyzes the screenshot and recreates it as simplified static HTML/CSS.
3. AI identifies the visual parts of the UI — backgrounds, cards, buttons, headings, links, captions, icons, etc.
4. AI groups those parts into color roles:
   - **Primary**: big structural areas like app background, nav bars, and tab bars.
   - **Secondary**: surfaces like cards, panels, inputs, and muted UI areas.
   - **Accent**: buttons, links, icons, brand marks, and highlight elements.
5. User can correct the AI's categorization in a kanban-style panel.
6. User presses **Space** to cycle through palettes instantly.
7. The preview updates live, so the user can feel how their actual UI looks in different color directions.
8. User exports the final palette as CSS variables or JSON tokens.

## Problem It Solves

Designers and developers often want to explore new color palettes for an existing interface, but current tools are disconnected from the real UI.

Tools like Coolors generate nice colors, but they do not show how those colors actually look on the user's app layout, typography, cards, nav bars, buttons, and visual hierarchy.

Without this tool, the user usually has to:

- manually recreate parts of the UI in Figma,
- manually assign colors,
- manually test palettes,
- or edit code repeatedly.

UI Palette Explorer removes that friction.

## Key Insight

**AI should do the one-time semantic mapping of the screenshot, then the user should get instant, tactile palette exploration with no more API calls.**

The product is not just about generating colors. It is about this loop:

**Upload your UI → AI understands the visual roles → rapidly vibe-test palettes on something that looks like your actual product.**

## Why the New Features Matter

The latest planned features strengthen that core loop by making the AI mapping more complete and user-controllable:

- **Color lock per role**: keep primary, secondary, or accent colors fixed while cycling palettes.
- **Add/remove elements**: let the user fix missed or incorrectly identified UI classes.
- **Categorize all elements**: include headings, body text, captions, links, button labels, and other text elements, not just broad surfaces.
- **Text color lock**: keep text readable by default with auto-contrasting white/black behavior, while still allowing users to unlock text for role-based coloring.
