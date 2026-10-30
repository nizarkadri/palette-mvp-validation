# Core Idea Checkpoint

Before implementing or reviewing any phase, ask:

> Does this make it easier for a user to upload their real UI, let AI map it once, then rapidly vibe-test palettes on that UI?

## Good Changes

A change is aligned if it:

- improves AI's one-time semantic mapping
- keeps palette cycling instant
- makes missed/incorrect AI mapping easy to fix
- keeps text readable by default
- keeps the preview as the main product surface
- makes export match what the user actually sees

## Risky Changes

A change is risky if it:

- adds API calls during palette cycling
- requires users to manually tag everything from scratch
- makes the side panel more important than the preview
- causes heavy React rerenders on every Space press
- makes text unreadable during normal cycling
- exports colors that do not match the preview

## Decision Rule

If a feature does not support the core loop, defer it unless it is required for safety or production readiness.
