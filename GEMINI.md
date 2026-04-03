# GEMINI.md

## Project Overview
**PocketPal AI** is a React Native mobile application for iOS and Android that enables local execution of Small Language Models (SLMs). It leverages `llama.cpp` through the `llama.rn` library to provide private, offline AI assistance.

- **Primary Stack:** React Native, TypeScript, MobX, WatermelonDB.
- **Inference Engine:** `llama.rn` (linked in `./llama.rn-upstream`).
- **UI Framework:** React Native Paper (Material Design).
- **Storage:** WatermelonDB (SQLite via JSI) for chats, messages, and settings.

## Building and Running
Ensure you have the React Native development environment set up for both iOS and Android.

### Core Commands
- **Start Metro:** `yarn start`
- **Run Android:** `yarn android`
- **Run iOS:** `yarn ios`
- **Run Tests:** `yarn test`
- **Type Check:** `yarn typecheck`
- **Lint:** `yarn lint`

### Build Commands
- **Android Debug:** `yarn build:android`
- **Android Release:** `yarn build:android:release`
- **iOS Debug:** `yarn ios:build`
- **iOS Release:** `yarn ios:build:release`

## Development Conventions

### Architecture & State Management
- **Stores:** Application logic and state are centralized in MobX stores within `src/store/`.
  - `ModelStore.ts`: Manages model lifecycle, loading, and inference.
  - `ChatSessionStore.ts`: Manages chat history and message flows.
- **Persistence:** WatermelonDB is used for all persistent data. Refer to `src/database/schema.ts` for the database structure and `src/repositories/` for data access patterns.
- **Services:** Complex side effects (e.g., downloads) are handled in `src/services/`.

### Code Style & Standards
- **TypeScript:** Strict typing is encouraged. Use `yarn typecheck` to verify.
- **Formatting:** Prettier is used for code formatting. Run `yarn format` to apply changes.
- **Linting:** ESLint is configured with React Native defaults. Run `yarn lint` or `yarn lint:fix`.
- **Commits:** Use [Conventional Commits](https://www.conventionalcommits.org/). Husky prevents non-compliant commits.

### LLM & Inference
- **Models:** Supported models are primarily GGUF format.
- **Hardware Optimization:** The app includes logic for device-specific optimizations (CPU threads, GPU offloading). See `src/utils/hardwareProfiles.ts`.
- **Templates:** Chat templates and system prompts are managed in `src/utils/chat.ts`.

## Key Files & Directories
- `src/store/`: Main application state containers.
- `src/database/`: Persistence layer configuration.
- `src/services/downloads/`: Logic for background model downloads.
- `src/utils/deviceCapabilities.ts`: Hardware detection and capability mapping.
- `package.json`: Dependency manifest and build scripts.
- `README.md`: User-facing documentation and setup guide.
