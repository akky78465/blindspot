# Blindspot

AI-assisted synthetic test data and edge-case generation for QA engineers. Upload existing cases → review the inferred feature map → choose missing scenarios → download an Excel workbook.

## Run locally

Requires **Node 24.15+** (use `nvm use`) and an Anthropic API key.

```sh
npm install
cp backend/.env.example backend/.env
# Edit backend/.env and set ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:4200. If that port is occupied, run the frontend separately with `` and open http://localhost:4207 (API requests use the dev proxy). The NestJS API listens on http://127.0.0.1:3000. Keep the key on the backend; never enter it in browser code. To run separately:

```sh
npm run dev -w backend
npm start -w frontend
```

`CLAUDE_MODEL` defaults to `claude-sonnet-5`, exactly as requested. The configured model must be available to your account **and support forced tool use**. If the provider rejects that combination, set `CLAUDE_MODEL` to an available model that supports it; Blindpot does not silently switch models or use fabricated AI responses. Model availability and a live Claude run have not been verified without credentials.

## Validation

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Backend tests cover upload parsing, PII masking, normalization storage, feature assignments, generation progress, deterministic data, workbook structure, and invalid selections. Browser tests use the real NestJS API with a test-only Claude protocol stub; they exercise the UI workflow, mobile layout, workbook download, and error handling without making billable calls. These tests do not validate the quality of live Claude reasoning.

`npm run sample` regenerates `samples/service-request-testcases.xlsx`. The frontend copies it into public assets before starting or building.

## Three-minute demo

1. **0:00–0:40 · Upload.** Download the sample from the upload screen (or select `samples/service-request-testcases.xlsx`). It contains 25 synthetic home-warranty cases spanning login, plans, appliances, descriptions, appointments, and submission. Click **Analyze test cases**, then review normalized source references. Most examples follow the happy path, leaving deliberate gaps.
2. **0:40–1:20 · Map.** Click **Map features**. Review inferred fields and rules, rename a feature, and expand assignments to move a case if needed. Red badges identify categories with no detected coverage. Constraints are inferred, so review assumptions before using the generated tests.
3. **1:20–2:20 · Discover.** Click **Find edge cases** and watch progress per feature. Explore priorities and categories. Open a card to inspect preconditions, steps, expected results, and the gap rationale. Choose **Select all high priority**, then adjust individual selections. This shortcut replaces the current selection with all high-priority cases, including cases outside active filters.
4. **2:20–3:00 · Export.** Review the selection and click **Download Excel**. Show the Edge Cases, Test Data, and Summary sheets. Values are deterministic and synthetic. Generation time depends on Claude latency and number of features; allow extra time for a live demo.

## Layout and API

- `frontend/`: Angular 22 standalone components, signals, Angular Material, zoneless change detection; typed API service and signal store.
- `backend/`: NestJS, official Anthropic SDK, Zod, SheetJS, Faker, ExcelJS.
- `backend/src/prompts/`: exported prompt templates for normalization, mapping, and edge-case analysis.
- `samples/`: the 25-case sample workbook.

| Method | Endpoint | Input / response |
| --- | --- | --- |
| POST | `/api/sessions/upload` | multipart `file` or JSON `{ "text": "..." }`; returns sessionId and normalized testCases |
| POST | `/api/sessions/:id/feature-map` | builds and returns FeatureMap |
| PUT | `/api/sessions/:id/feature-map` | accepts the edited complete FeatureMap; invalidates suggestions |
| POST | `/api/sessions/:id/edge-cases` | one Claude call per feature; returns `{suggestions}` sorted high to low |
| GET | `/api/sessions/:id/progress` | completed, total, current feature, status |
| POST | `/api/sessions/:id/export` | `{ "selectedIds": ["EC-001"] }`; streams XLSX |
| GET | `/api/sessions/health` | local service health |

Upload normalization batches spreadsheets into 30-row chunks. Files are limited to 5 MB, 600 rows, and 500,000 extracted characters; pasted text is limited to 100,000 characters. Source references preserve actual sheet row numbers. Claude responses use a forced tool with a Zod-derived JSON schema; validation failures retry once with the error message. SDK transport retries are separate. Exact duplicate titles are filtered locally; semantic deduplication depends on Claude and still needs human review. Suggestions are capped at 18 per feature to bound output size.

Feature edits require every existing case to belong to exactly one feature. Features are analyzed in parallel (up to `EDGE_CONCURRENCY`, default 4) with an observable progress endpoint and a per-session lock. Suggestion IDs are assigned in feature order, so results match sequential generation. Failed generation does not publish partial results. Editing features clears old suggestions. Moving a test case retains the feature’s inferred coverage metadata; review the map or regenerate it if assignments materially change the analysis.

## Synthetic data and coverage

Data specs support boundaries, number ranges, exact lengths, long strings, null/empty/whitespace, Unicode, invalid formats, fixed dates, duplicate values, and SQL/XSS strings. Faker instances are seeded by case and input index, keeping repeated exports stable. Emails use the reserved `.test` domain and phone values use fictional 555-01xx numbers. Long values are bounded at 10,000 characters. JSON encoding in the Test Data sheet preserves the distinction between null, empty strings, and whitespace. Formula-like values are written as Excel string cells, not executable formulas.

Summary coverage means **inferred categories represented**, before and after adding selected suggestions. It is not an executed-test metric or a guarantee of completeness. Priority and expected behavior require QA review.

## POC limits

No database or authentication. Sessions are held in a Map, disappear on restart, and inactive sessions older than four hours are cleaned up on subsequent uploads. Restarting/reloading the browser starts a new workflow. The API binds to loopback; CORS is configured with `FRONTEND_ORIGIN` (default `http://localhost:4200`). This is a local hackathon app, not a multi-user deployment.

Regex masking is best-effort for emails, phones, and card-like sequences, and runs before every Claude request. It does not detect all sensitive data (such as names, addresses, or secrets). Use synthetic input for demos. Masking may also obscure numeric boundary values that resemble phone/card numbers.

## Implementation checks

The build and automated tests can run without an API key. A live acceptance check requires your key: upload the sample, generate its map and suggestions, then download and open the workbook. Missing credentials, inaccessible models, rate limits, or rejected forced tool use are surfaced as actionable UI errors.

Implementation references: [Angular release policy](https://angular.dev/reference/releases), [Anthropic tool definitions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools).

Dependency audit: Faker was updated to the patched 10.6 release. ExcelJS 4.4 currently brings an older uuid dependency, resulting in two moderate audit entries (ExcelJS and uuid for the same underlying issue). The advisory concerns uuid v3/v5/v6 buffer handling; this export flow uses ExcelJS’s v4 path. Review upstream updates before any production deployment.
