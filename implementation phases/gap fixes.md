# Gap Fixes

These fixes should be considered while implementing the phases.

## 1. Sanitize AI HTML

The app renders AI-generated HTML. Prompt instructions are not enough. Add sanitization before rendering.

Recommended dependency:

```bash
npm install dompurify
```

## 2. Validate returned classes

Every element id returned by the AI should appear as a class in the returned HTML.

If not:

- filter it out, or
- keep it with a warning state

Preferred first implementation: filter and log a warning.

## 3. Avoid generic class leakage

Class names like `text`, `button`, or `card` may be too generic.

Current mitigation:

- palette engine queries are scoped to preview root.

Future improvement:

- warn when AI returns overly generic class ids.

## 4. Reset styles before removing elements

If an element is removed from control, clear inline styles from matching preview nodes first.

Otherwise removed elements may keep stale palette colors.

## 5. Export effective palette

Export should match what the user sees, not the raw base palette.

## 6. Preserve Space cycling performance

Do not call AI, mutate HTML strings, or trigger heavy operations during palette cycling.

Only apply inline styles to existing DOM nodes.

## 7. Contrast improvement path

Initial implementation can follow the idea doc and use `palette.primary` to determine light/dark.

Future improvement:

- calculate contrast against actual element background when possible.
