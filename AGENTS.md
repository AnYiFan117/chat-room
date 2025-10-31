# Repository Guidelines

## important

1. 用中文回答用户
2. 在执行完用户的指令之后，不要自动使用npm run编译程序，而是要提示用户你修改了什么地方，让用户自己编译。
3. 不需要测试，除非用户要求

Contributors should keep changes focused, verified locally, and aligned with the Vue 3 + Vite stack already in place.

## Environment & Tooling
- Use Node.js 20.19+ (see `package.json` engines) and run `npm install` before development.
- VS Code with the official Vue and Volar extensions plus Prettier keeps `.vue` type hints and formatting consistent.
- Configuration lives in `vite.config.ts`, `tsconfig*.json`, and `eslint.config.ts`; review these before changing build or lint behaviour.

## Project Structure & Module Organization
- Feature code sits in `src/`: `components/` for reusable UI, `views/` for router-backed pages, `stores/` for Pinia state, and `router/` for route definitions.
- Static assets belong in `src/assets/` (imported) or `public/` (served as-is). End-to-end specs sit under `e2e/`, unit specs under `src/**/__tests__/`.
- Avoid deeply nested component trees; split shared logic into composables or Pinia stores to keep files approachable.

## Build, Test, and Development Commands
- `npm run dev` launches Vite with hot reload; `npm run preview` previews the production build locally.
- `npm run build` runs type-checking plus bundling (`npm run build-only` skips type-checks).
- `npm run lint` auto-fixes ESLint issues; `npm run format` enforces Prettier in `src/`.
- `npm run test:unit` executes Vitest suites; `npm run test:e2e` runs Playwright after browsers are installed via `npx playwright install`.

## Coding Style & Naming Conventions
- Prefer `<script setup lang="ts">` with TypeScript types; keep indentation at two spaces.
- Component files stay in PascalCase (e.g., `HelloWorld.vue`), composables in `useSomething.ts`, and Pinia stores in `*.store.ts`.
- Rely on ESLint + Prettier for consistency; commit only lint-clean code.

## Testing Guidelines
- Co-locate unit specs as `*.spec.ts` inside `__tests__` folders; mirror component naming (`HelloWorld.spec.ts`).
- Exercise primary interactions in Vitest, using Vue Test Utils for mounts and spies.
- Playwright specs in `e2e/` should start from `/`, assert user-visible outcomes, and clean up state. Build the app before running them in CI.

## Commit & Pull Request Guidelines
- Write imperative, present-tense commit messages following Conventional Commit prefixes when possible (e.g., `feat: add profile view`).
- Squash fixups locally; keep commits scoped so reviewers can reason about them quickly.
- Every PR needs a short summary, linked issue (if any), local test evidence (`npm run lint`, `npm run test:unit`, etc.), and screenshots or clips for UI changes.
