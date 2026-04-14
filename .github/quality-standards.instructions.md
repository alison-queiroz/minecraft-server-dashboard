---
applyTo: "**/*.ts,**/*.html,**/*.scss,**/*.py,tsconfig*.json,eslint.config.*,angular.json,tailwind.config.*"
---

# Quality Standards
## General Preferences
- All generated code, function names, variables, and comments must be strictly in English.
- Avoid adding comments unless strictly necessary. If a comment is mandatory to explain complex logic, it must be in English.

## TypeScript / Angular

### Build System
- Always use the modern Angular esbuild/Vite build system. In `angular.json`, the architect build builder must be `@angular-devkit/build-angular:application` (never the legacy `:browser` builder).

### tsconfig
- Root `tsconfig.json` must have `strict: true`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- `tsconfig.app.json` must have `"rootDir": "./src"` to prevent TS output-layout warnings
- `angularCompilerOptions` must include `strictInjectionParameters`, `strictInputAccessModifiers`, `strictTemplates`

### Variable Declarations
- Always use `const`. Never use `let` unless the binding is genuinely reassigned later in the same scope.
- Never use `any` or `unknown` — always use a specific type.

### Template Bindings
- Never use `ngModel` or `ngModelChange` (legacy two-way binding). Use `[value]` + `(input)` with signal-based binding instead: `[value]="sig()" (input)="sig.set($any($event.target).value)"`.

### Imports
- Always use `import type { Foo }` for type-only imports (enforced by `@typescript-eslint/consistent-type-imports`)
- If a file imports both a type and a value from the same module, split into two import statements: one `import type`, one `import`

### Components / Directives
- Always use standalone components with `ChangeDetectionStrategy.OnPush` and Angular signals (`signal()`, `computed()`)
- Component selector prefix: `app-` (kebab-case); directive selector prefix: `app` (camelCase)
- Use modern Angular control flow (`@if`, `@for`, `@switch`) instead of legacy structural directives (`*ngIf`, `*ngFor`)
- Interactive directives (click, hover, keyboard) must handle both mouse events AND `focus`/`blur` for keyboard accessibility
- Unused variables prefixed with `_` to satisfy `no-unused-vars` rule

### UI Componentization & Composition
- Favor **Composition over Inheritance** for building UI elements. Use `<ng-content>` (content projection) with select attributes to create flexible, reusable layout wrappers (e.g., a generic `app-card` or `app-list-item`) instead of deep TypeScript class hierarchies.
- Extract highly repeated visual elements (like chips, badges, quick-nav links) into "dumb" presentation components within a `shared/ui` directory.
- Strictly use Angular Signal inputs (`input()`, `input.required()`) to pass configuration (variants, colors, icons, text) to these dumb components.
- Do not duplicate raw SVG paths inline across multiple files. Use a centralized icon component or registry.

### CSS / SCSS & Theming
- The application must explicitly support both Light and Dark modes.
- Keep HTML templates clean: **Strictly avoid long inline Tailwind class strings.** Limit inline utility classes to an absolute maximum of 4-5 per element.
- Extract complex styling, grid layouts, responsive modifiers, and state utilities into semantic classes within the component's `.scss` file using Tailwind's `@apply` directive.
- Use Tailwind's `dark:` modifier (via `@apply` in SCSS or inline if short) for dark mode styles. Theme toggling is managed by a `dark` class on the `<html>` or `<body>` element.
- Use `@media` breakpoints in component SCSS instead (e.g., `@media (max-width: 639px)`) if `@apply` is not sufficient for complex responsive logic.
- Styles for elements appended to `document.body` at runtime (overlays, tooltips, portals) cannot use component SCSS encapsulation. Extract to a `_partial.scss` file co-located with the directive and import it via `@use` in `styles.scss`.

### PWA / HTML
- Every `<html>` element requires a `lang` attribute
- PWA manifests must include `<link rel="apple-touch-icon">` pointing to an actual file in `assets/icons/`
- Always include `<meta name="theme-color" content="#FFFFFF">` to ensure native app-like top bar styling on mobile WebKit and Chromium browsers

---

## ESLint

Key rules to keep in every `eslint.config.js` for Angular+TypeScript projects:
- `prefer-const`: `error` — always `const`, only `let` when the binding is genuinely reassigned
- `@typescript-eslint/no-explicit-any`: `error` — no `any` in production or test code
- `@typescript-eslint/no-restricted-types`: ban `unknown`
- `@typescript-eslint/consistent-type-imports`: `warn`, `prefer: type-imports`
- `@typescript-eslint/no-unused-vars`: `error`, ignore `^_` prefix for vars and args
- `@typescript-eslint/no-floating-promises`: `warn`
- `@typescript-eslint/no-misused-promises`: `warn`, `checksVoidReturn: false`
- `angular-eslint`: Enable recommended rules for standalone components and accessibility
- `complexity`: `warn` at `12` — keep branching visible without blocking iteration
- `no-restricted-imports`: warn on deep page-internal imports (`pages/*/*`)
- Use `tsconfig.eslint.json` (extends `tsconfig.json`, includes `src/**/*.ts`) as the parser project for type-aware rules

---

## Testing — Angular (Jest / Web Test Runner)

- Every new component and directive gets a `*.spec.ts` file in the same folder
- Use **Vitest** as the unit test runner to leverage the Vite ecosystem. Migrate any legacy Karma configurations to Vitest
- Never use `/* v8 ignore */` or `/* istanbul ignore */` comments. Write tests to cover the branch instead.
- Always configure tests to run zoneless (e.g., using `provideExperimentalZonelessChangeDetection()` in `TestBed.configureTestingModule`) to align with Signal-based change detection and avoid Zone.js flakiness
- Regression tests: when a bug is fixed, add a test for the broken branch (e.g., `isRaw=true` vs `isRaw=false` skin rendering)
- Use `import type { ComponentFixture }` (type-only) + separate `import { TestBed }` to satisfy the lint rule
- E2e tests (Playwright) must cover mobile viewport (375x812) for any feature that hides/shows columns or changes layout below 640px

---

## Testing & Quality — Python (pytest + pytest-mock)

- Always use strict type hints from the `typing` module for all function arguments and return values (e.g., `def fetch_data(user_id: int) -> dict:`)
- Test files live in `tests/` at the project root, named `test_<module>.py`
- Dev dependencies (`pytest>=8.0.0`, `pytest-mock>=3.12.0`) go in `requirements-dev.txt`, not `requirements.txt`
- When testing web frameworks (like Flask or FastAPI), always use the framework's native test client
- Mock auth and Firebase before calling any protected endpoint:
  ```python
  mocker.patch("api.server_api._FIREBASE_INITIALIZED", True)
  mocker.patch("firebase_admin.auth.verify_id_token", return_value={"uid": "mocked_user_id"})
  ```

- Always test the unauthorized path (no token -> 401) before testing the authorized path
- Mock I/O functions (get_players, file readers) to keep tests fast and hermetic — tests must not read from disk or network
- Docstrings on every test function: one sentence explaining what it asserts
- Use coverage in CI and local checks: `pytest --cov=api --cov-report=term-missing`
- For strict quality gates, require full coverage with `--cov-fail-under=100`

## CI / GitHub Actions
- Use `browser-actions/setup-chrome@v1` with `id: setup-chrome`; reference the output as `steps.setup-chrome.outputs.chrome-path` — the id must match exactly
- Ensure caching is enabled for both npm/yarn and pip to accelerate build times
- Separate jobs for: lint, typecheck, unit tests, e2e tests, Python tests
- `ci:quality` script in `package.json` should run lint + typecheck + frontend unit tests + Python unit tests in sequence
- Add a coverage-focused script (for example `ci:quality:coverage`) to run frontend and backend coverage reports
