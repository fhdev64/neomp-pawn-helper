# Pawn Helper

Pawn Helper adds lightweight editor support for Pawn projects in Visual Studio Code.

## Features

- Registers Pawn files with `.pwn`, `.inc`, and `.module` extensions.
- Highlights color literals written as `0xRRGGBB`, `0xRRGGBBAA`, and `{RRGGBB}`.
- Highlights any named `#define` that contains a color value, including `0xRRGGBB`, `0xRRGGBBAA`, `{RRGGBB}`, `RRGGBB`, and `RRGGBBAA`.
- Allows named color variable/define highlighting to be disabled separately from raw color literals.
- Adds Ctrl+Click links for paths after `#include`.
- Shows inline value hints next to uses of named `#define`, `const`, and enum constants with simple integer or float values.
- Provides go to definition for indexed Pawn symbols, including `Namespace::Function` names.
- Indexes functions, globals, defines, enum members, and dialog declarations.
- Supports paired navigation between `global` implementations and `foreign` declarations.
- Highlights SQL keywords and `mysql_format` placeholders such as `%i`, `%e`, `%d`, and `%s` inside SQL string literals.
- Suggests ready-made SQL snippets after `INSERT`, `UPDATE`, `DELETE`, and `SELECT` in `format` and MySQL query string arguments.
- Warns when `mysql_format` placeholder counts do not match the provided value arguments.
- Links MySQL query callbacks back to the `mysql_tquery`, `mysql_pquery`, or `mysql_function_query` call that references them.
- Adds `Pawn Helper: Generate Enum from CREATE TABLE` for creating Pawn enum constants from a selected SQL table schema.
- Adds `Pawn Helper: Reindex Workspace` for manually rebuilding the workspace index.

## Settings

- `livePawnHelper.colors.enabled`: enable or disable color highlighting.
- `livePawnHelper.colors.variables.enabled`: enable or disable highlighting for named color variables and defines.
- `livePawnHelper.constants.valueHints.enabled`: enable or disable inline value hints for numeric constants.
- `livePawnHelper.definitions.enabled`: enable or disable go to definition.
- `livePawnHelper.sql.highlighting.enabled`: enable or disable SQL string highlighting.
- `livePawnHelper.sql.diagnostics.enabled`: enable or disable `mysql_format` placeholder diagnostics.
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
