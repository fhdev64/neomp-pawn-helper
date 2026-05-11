# Pawn Helper

Pawn Helper adds lightweight editor support for Pawn projects in Visual Studio Code.

## Features

- Registers Pawn files with `.pwn`, `.inc`, and `.module` extensions.
- Highlights color literals written as `0xRRGGBB`, `0xRRGGBBAA`, and `{RRGGBB}`.
- Highlights named color defines such as `#define rgbaRed 0xFF0000AA`.
- Provides go to definition for indexed Pawn symbols.
- Indexes functions, globals, defines, enum members, and dialog declarations.
- Supports paired navigation between `global` implementations and `foreign` declarations.
- Adds `Pawn Helper: Reindex Workspace` for manually rebuilding the workspace index.

## Settings

- `livePawnHelper.colors.enabled`: enable or disable color highlighting.
- `livePawnHelper.definitions.enabled`: enable or disable go to definition.
- `livePawnHelper.index.include`: workspace glob patterns used for indexing.
- `livePawnHelper.index.exclude`: workspace glob patterns ignored during indexing.
- `livePawnHelper.index.maxFiles`: maximum number of Pawn files to index.
- `livePawnHelper.index.debounceMs`: delay before rebuilding the index after file changes.

## Local Development

Run the syntax check:

```bash
npm run check
```

Build a local VSIX package:

```bash
npm run package
```

Install the generated `.vsix` from the Extensions view with `Install from VSIX...`.
