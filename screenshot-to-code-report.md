# Screenshot-to-Code — Architecture & Flow Report

## Overview

**Screenshot-to-Code** (by [abi](https://github.com/abi)) is an open-source application that converts screenshots, mockups, Figma designs, screen recordings, and text descriptions into clean, functional frontend code using AI. It supports multiple output stacks (HTML+Tailwind, React+Tailwind, Vue+Tailwind, Bootstrap, Ionic+Tailwind, HTML+CSS) and multiple AI model providers (OpenAI GPT, Anthropic Claude, Google Gemini, Replicate).

The hosted version is available at [screenshottocode.com](https://screenshottocode.com). The project has ~73K stars and ~9K forks on GitHub.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React + TypeScript, Vite bundler |
| **Backend** | Python, FastAPI (async) |
| **Real-time Communication** | WebSocket (bidirectional streaming) |
| **AI Providers** | OpenAI (GPT-5.4/5.5), Anthropic (Claude Opus/Sonnet/Fable), Google Gemini (3 Flash/3.1 Pro), Replicate (image generation/editing) |
| **Screenshot Capture** | ScreenshotOne API |
| **Styling** | Tailwind CSS, CSS Modules |
| **State Management** | Zustand (app-store, project-store) + React hooks |
| **Persistence** | LocalStorage (settings), filesystem (design systems) |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React/Vite)                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ App.tsx  │→ │ generateCode │→ │ WebSocket Client      │ │
│  │ (state)  │  │   .ts        │  │ (streaming messages)  │ │
│  └──────────┘  └──────────────┘  └───────────┬───────────┘ │
│                                              │              │
│  ┌──────────────────────────────────────────┐│              │
│  │ Components: Sidebar, HistoryDisplay,     ││              │
│  │ CodeViewer, SelectAndEdit, ChatView      ││              │
│  └──────────────────────────────────────────┘│              │
└──────────────────────────────────────────────┼──────────────┘
                                               │ WebSocket
┌──────────────────────────────────────────────┼──────────────┐
│  Backend (FastAPI)                           │              │
│  ┌───────────────────────────────────────────┴────────────┐ │
│  │ WebSocket Endpoint: /generate-code                      │ │
│  │ ┌─────────────────────────────────────────────────────┐ │ │
│  │ │ Pipeline (Middleware Chain):                        │ │ │
│  │ │  1. ParameterExtractionStage                        │ │ │
│  │ │  2. ModelSelectionStage                             │ │ │
│  │ │  3. PromptBuildingStage                             │ │ │
│  │ │  4. AgenticGenerationStage                          │ │ │
│  │ └─────────────────────────────────────────────────────┘ │ │
│  │                          │                              │ │
│  │ ┌────────────────────────┴────────────────────────────┐ │ │
│  │ │ AgentEngine (agent/engine.py)                       │ │ │
│  │ │  ├─ Provider Session (OpenAI/Anthropic/Gemini)     │ │ │
│  │ │  ├─ Tool Calling Loop (max 100 turns)              │ │ │
│  │ │  ├─ AgentToolRuntime                               │ │ │
│  │ │  │   ├─ create_file                                 │ │ │
│  │ │  │   ├─ edit_file                                   │ │ │
│  │ │  │   ├─ generate_images (Replicate/OpenAI)          │ │ │
│  │ │  │   ├─ remove_background (Replicate)               │ │ │
│  │ │  │   ├─ edit_image (Replicate)                      │ │ │
│  │ │  │   ├─ extract_assets (Gemini)                     │ │ │
│  │ │  │   ├─ save_assets                                 │ │ │
│  │ │  │   ├─ screenshot_preview                          │ │ │
│  │ │  │   └─ retrieve_option                             │ │ │
│  │ │  └─ FileState management                           │ │ │
│  │ └────────────────────────────────────────────────────┘ │ │
│  │                                                         │ │
│  │ Other Routes:                                           │ │
│  │  ├─ /api/screenshot (ScreenshotOne integration)         │ │
│  │  ├─ /api/export (ZIP export with asset bundling)       │ │
│  │  ├─ /api/design-systems (CRUD for design systems)      │ │
│  │  ├─ /api/evals (evaluation data)                       │ │
│  │  └─ /api/prompt-reports (prompt analytics)             │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Detailed Backend Flow

### 1. WebSocket Connection (`/generate-code`)

The entire code generation flow happens over a **single WebSocket connection**. The frontend connects and sends a JSON payload containing:

- `generationType`: `"create"` or `"update"`
- `inputMode`: `"image"`, `"video"`, or `"text"`
- `prompt`: text + images (as data URLs) + optional video frames
- `history`: prior conversation turns (for iterative refinement)
- `stack`: target output (HTML_TAILWIND, REACT_TAILWIND, etc.)
- API keys (optional — can be server-configured)
- `isImageGenerationEnabled`, `model`, etc.

### 2. Pipeline Middleware

The backend processes the request through a **chain-of-responsibility middleware pipeline**:

#### Stage 1: Parameter Extraction (`ParameterExtractionStage`)

- Validates and normalizes incoming parameters
- Extracts: `generationType`, `inputMode`, `stack`, `openaiApiKey`, `anthropicApiKey`, `geminiApiKey`, `replicateApiKey`, `shouldGenerateImages`, `model`, `history`, `fileState` (for updates), etc.

#### Stage 2: Model Selection (`ModelSelectionStage`)

- Based on available API keys, selects a set of model variants to run in parallel
- Uses predefined model groupings (e.g., `ALL_KEYS_MODELS_DEFAULT`, `GEMINI_ANTHROPIC_MODELS`, etc.)
- If video mode → uses `VIDEO_VARIANT_MODELS` (requires Gemini)
- Default: runs `NUM_VARIANTS` variants (configurable, typically 2)
- Key models: Gemini 3 Flash/3.1 Pro, Claude Opus 4.6/4.8, GPT-5.5 (various reasoning levels)

#### Stage 3: Prompt Building (`PromptBuildingStage`)

- Constructs the prompt messages list from images, text, history, and stack type
- Uses the prompt pipeline (`prompts/pipeline.py`) to build structured messages
- Appends uploaded asset IDs to the prompt content
- Supports both "create" (from scratch) and "update" (iterative edit) modes
- For updates, sends file snapshots for context

#### Stage 4: Agentic Generation (`AgenticGenerationStage`)

- For each selected model variant, creates an **AgentEngine** instance
- The agent runs in a **tool-calling loop** (up to 100 turns):
  1. Sends prompt to the LLM provider (OpenAI/Anthropic/Gemini)
  2. Receives streaming response with potential **tool calls**
  3. Executes tool calls via `AgentToolRuntime`
  4. Appends tool results back to the conversation
  5. Repeats until the agent finishes or max turns reached
- **Streams events back to the frontend** via WebSocket:
  - `chunk`: streaming text/code tokens
  - `status`: progress updates
  - `setCode`: full code output (from `create_file`/`edit_file` tools)
  - `thinking`: reasoning traces (for reasoning models)
  - `assistant`: assistant messages
  - `toolStart` / `toolResult`: tool execution progress
  - `variantComplete` / `variantError`: per-variant completion status
  - `variantCount` / `variantModels`: metadata about running variants

### 3. Agent Tools

The agent can use these tools during code generation:

| Tool | Description |
|------|-------------|
| `create_file` | Write the initial HTML file (full content) |
| `edit_file` | Make precise edits via exact string replacements (with unified diff output) |
| `generate_images` | Generate images from text prompts (Replicate z-image-turbo or OpenAI) |
| `remove_background` | Remove backgrounds from images (Replicate) |
| `edit_image` | Edit images with text prompts (Replicate, supports aspect ratios) |
| `extract_assets` | Extract real visual assets (logos, icons) from the input screenshot using Gemini |
| `save_assets` | Save user-uploaded images as permanent assets |
| `screenshot_preview` | Take a screenshot of the generated HTML for visual verification |
| `retrieve_option` | Read back a previously generated variant's HTML |

### 4. LLM Abstraction

The `Llm` enum defines all supported models with explicit provider mapping:

- **OpenAI**: GPT-5.4 (5 reasoning levels), GPT-5.5 (5 reasoning levels)
- **Anthropic**: Claude Sonnet 4.6, Opus 4.6/4.8 (5 effort levels), Fable 5 (5 effort levels)
- **Gemini**: 3 Flash Preview (high/minimal), 3.1 Pro Preview (high/medium/low), 3.5 Flash (high)

Provider sessions are created via a factory pattern (`agent/providers/factory.py`) that abstracts the differences between OpenAI, Anthropic, and Gemini APIs.

### 5. Other Backend Routes

- **`POST /api/screenshot`**: Captures a screenshot of a URL using the ScreenshotOne API
- **`GET/POST /api/design-systems`**: CRUD for reusable design system prompts (stored as JSON files)
- **`GET /api/export`**: Exports generated code as a ZIP file, inlining all assets as data URLs
- **`GET /api/evals`**: Serves evaluation/test data
- **`GET /api/prompt-reports`**: Serves prompt analytics data

---

## Detailed Frontend Flow

### 1. App Initialization (`App.tsx`)

The main component manages:

- **App state machine**: `INITIAL` → `CODING` → `CODE_READY` (with error states)
- **Settings**: persisted to localStorage (API keys, model preference, editor theme, stack selection)
- **History**: conversation history for iterative refinement (using `prompt-history` utilities)
- **Project state**: via Zustand stores (`app-store`, `project-store`)
- **Design systems**: custom design system prompts loaded from the backend

### 2. Code Generation Trigger

When the user submits a screenshot/text:

1. `doGenerateCode()` is called with a `GenerationRequest` object
2. This calls `generateCode()` from `generateCode.ts`
3. A WebSocket connection is opened to `ws://backend/generate-code`
4. The request params are sent as JSON

### 3. WebSocket Message Handling (`generateCode.ts`)

The WebSocket client handles these message types from the backend:

| Message Type | Action |
|-------------|--------|
| `chunk` | Append code chunk to the live code display |
| `setCode` | Replace the full code (from tool output) |
| `status` | Show progress status |
| `variantCount` | Display how many variants are running |
| `variantModels` | Show which models are being used |
| `thinking` | Display reasoning traces (collapsible) |
| `assistant` | Display assistant messages |
| `toolStart` / `toolResult` | Show tool execution in a console panel |
| `variantComplete` | Mark a variant as done |
| `variantError` | Show error for a specific variant |
| `error` | Show global error |

### 4. Iterative Refinement (Update Mode)

Users can refine generated code by:

- Typing text instructions (e.g., "make the header blue")
- Selecting elements on the screenshot and describing edits
- The frontend sends the current code as `fileState` + the update instruction as a new prompt
- History messages are accumulated for multi-turn conversations

### 5. Select and Edit Mode

Users can click on elements in the screenshot to:

- Describe desired changes for specific elements
- The frontend builds a `selectedElementHtml` context string
- This is sent as part of the update prompt

### 6. Export

The frontend can export the generated code as a ZIP file via the `/api/export` endpoint, which bundles all assets (images as data URLs) into a single downloadable file.

---

## Key Design Patterns

1. **Pipeline/Middleware Pattern**: The backend uses a clean middleware chain for processing requests, making it easy to add/remove stages.

2. **Agentic Tool Calling**: Rather than simple prompt→code, the system uses an agent that can iteratively call tools (create files, edit files, generate images, extract assets) to build up the final output.

3. **Multi-Variant Generation**: Multiple AI models run in parallel for the same input, giving users different code variants to choose from.

4. **WebSocket Streaming**: All real-time communication (code streaming, status updates, tool execution) happens over a single persistent WebSocket connection.

5. **File State Management**: The agent maintains a virtual file state (dictionary of path→content) that persists across tool calls within a generation session.

6. **Provider Abstraction**: The LLM layer abstracts away differences between OpenAI, Anthropic, and Gemini APIs behind a common interface.

---

## Data Flow Summary

```
User uploads screenshot/text
        │
        ▼
Frontend: App.tsx → doGenerateCode()
        │
        ▼
Frontend: generateCode.ts → WebSocket → Backend
        │
        ▼
Backend: ParameterExtractionStage (validate & normalize)
        │
        ▼
Backend: ModelSelectionStage (pick N models based on API keys)
        │
        ▼
Backend: PromptBuildingStage (construct prompt messages from images + text + history)
        │
        ▼
Backend: AgenticGenerationStage (for each model variant, in parallel):
    ┌───────────────────────────────────────────┐
    │ AgentEngine tool-calling loop:            │
    │  → Send prompt to LLM                    │
    │  → Receive tool calls                    │
    │  → Execute tools (create/edit/generate)  │
    │  → Append results → repeat              │
    │  → Stream events back via WebSocket     │
    └───────────────────────────────────────────┘
        │
        ▼
Frontend: Handle WebSocket messages → update UI (code display, status, tool console)
        │
        ▼
User views generated code, can refine via text or select-and-edit
        │
        ▼
(Repeat from doGenerateCode with history + fileState)
```

---

## Configuration

Required environment variables in `backend/.env`:

- At least one of: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- `GEMINI_API_KEY` strongly recommended (powers asset extraction + video mode)
- `REPLICATE_API_KEY` strongly recommended (image generation/editing/background removal)

Frontend config in `frontend/.env.local`:

- `VITE_HTTP_BACKEND_URL` / `VITE_WS_BACKEND_URL` — backend connection URLs
