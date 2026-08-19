# Changelog

## 1.0.4

- Added semantic highlighting for namespaced Pawn calls so `Namespace::Function` no longer colors `::` as a tag separator.
- Added context-aware go-to-definition for `this.Method()` calls created by `#define this. THIS__(Tag)`.
- Added go-to-definition aliases from generated `Tag_Method` calls to source `Tag::Method` functions.

## 1.0.2

- Made Ctrl+Click highlight the full `Namespace::Function` source range.
- Added a Pawn word pattern that treats `Namespace::Function` as one symbol.

## 1.0.1

- Added go-to-definition support for namespaced Pawn functions such as `Interface::WT_RemoveParticipant`.
- Namespaced and non-namespaced functions are indexed as separate symbols.

## 1.0.0

- Reworked Pawn indexing so edits update only the changed document instead of rebuilding the whole workspace.
- Added `livePawnHelper.index.documentDebounceMs` for edited-document index updates.
- Read closed Pawn files as `windows-1251` during indexing.
- Activated the extension only for opened Pawn documents instead of scanning Pawn workspaces on startup.
- Debounced numeric value hint refreshes during typing.

## 0.0.12

- Added `livePawnHelper.colors.variables.enabled` to disable named color variable/define highlighting while keeping raw color literals highlighted.
- Added Ctrl+Click links for paths after `#include`.

## 0.0.11

- Fixed `mysql_format` diagnostics for SQL format strings split across multiple Pawn string literals.

## 0.0.10

- Added inline value hints for uses of named `#define`, `const`, and enum constants with simple integer or float values.
- Numeric value hints skip declarations and named color defines so existing color highlighting remains unchanged.

## 0.0.9

- Fixed SQL snippet suggestions not appearing after typed `INSERT`, `UPDATE`, `DELETE`, or `SELECT` keywords inside query string arguments.
- SQL snippet completions now trigger suggest after the keyword space and are shown as regular completion items with snippet tab stops.

## 0.0.8

- Fixed SQL snippets inside `mysql_format` calls that use a `format`-style argument order, for example `mysql_format(buffer, sizeof buffer, "SELECT ...")`.

## 0.0.7

- Added the extension icon for the VS Code extension gallery and installed extension view.

## 0.0.6

- Added context-aware SQL snippets for `INSERT`, `UPDATE`, `DELETE`, and `SELECT` inside `format`, `mysql_format`, `mysql_tquery`, `mysql_pquery`, `mysql_query`, and `mysql_function_query` query strings.

## 0.0.5

- Added SQL keyword and `mysql_format` placeholder highlighting inside SQL string literals.
- Added `mysql_format` diagnostics for mismatched placeholder and value argument counts.
- Added MySQL callback references so query callbacks can jump back to their query call sites.
- Added `Pawn Helper: Generate Enum from CREATE TABLE`.
- Fixed `mysql_format` placeholder counting for `%i` and other common Pawn format specifiers.

## 0.0.3

- Color highlighting now recognizes any named `#define` that contains a color value.
- Added support for bare `RRGGBB` and `RRGGBBAA` color values inside `#define` bodies.
- Updated color highlighting documentation and setting descriptions.

## 0.0.2

- Added `global`/`foreign` navigation for exported Pawn functions.
- Clicking a regular function call now prefers the matching `global` implementation.
- Clicking a `global` declaration jumps to the matching `foreign` declaration.
- Clicking a `foreign` declaration jumps back to the matching `global` implementation.
- Added support for `global`/`foreign` signatures with return tags, for example `global bool:Name(...)` and `foreign Float:Name(...)`.

## 0.0.1

- Initial local release with Pawn file registration, color highlighting, workspace symbol indexing, and go-to-definition support.
