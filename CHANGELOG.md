# Changelog

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
