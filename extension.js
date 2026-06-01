"use strict";

const vscode = require("vscode");

const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/;
const CONTROL_WORDS = new Set([
    "assert",
    "break",
    "case",
    "continue",
    "default",
    "do",
    "else",
    "for",
    "if",
    "return",
    "sizeof",
    "state",
    "switch",
    "while"
]);
const SYMBOL_KIND_RANK = new Map([
    ["dialog", 0],
    ["enum-member", 1],
    ["define", 2],
    ["global-function", 3],
    ["function", 4],
    ["foreign", 5],
    ["global", 6],
    ["enum", 7],
    ["local", 8]
]);

function activate(context) {
    const index = new PawnIndex();
    const highlighter = new ColorHighlighter(index);
    const definitionProvider = new PawnDefinitionProvider(index);

    context.subscriptions.push(index, highlighter, definitionProvider);
    context.subscriptions.push(vscode.commands.registerCommand("livePawnHelper.reindex", async () => {
        await index.rebuild();
        highlighter.updateVisibleEditors();
        vscode.window.setStatusBarMessage("Live Pawn Helper: workspace reindexed", 2500);
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (
            event.affectsConfiguration("livePawnHelper.index") ||
            event.affectsConfiguration("livePawnHelper.colors") ||
            event.affectsConfiguration("livePawnHelper.definitions")
        ) {
            index.scheduleRebuild();
            highlighter.updateVisibleEditors();
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (!isPawnDocument(event.document)) {
            return;
        }

        highlighter.scheduleUpdate(event.document);
        index.scheduleRebuild();
    }));

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        if (isPawnDocument(document)) {
            index.scheduleRebuild();
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        if (isPawnDocument(document)) {
            highlighter.scheduleUpdate(document);
            index.scheduleRebuild();
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => index.scheduleRebuild()));
    context.subscriptions.push(vscode.workspace.onDidCreateFiles(() => index.scheduleRebuild()));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(() => index.scheduleRebuild()));
    context.subscriptions.push(vscode.workspace.onDidRenameFiles(() => index.scheduleRebuild()));

    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
        highlighter.updateVisibleEditors();
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            highlighter.scheduleUpdate(editor.document);
        }
    }));

    index.rebuild().then(() => highlighter.updateVisibleEditors());
}

function deactivate() {}

class PawnIndex {
    constructor() {
        this.symbols = new Map();
        this.dialogs = new Map();
        this.colors = new Map();
        this.rebuildTimer = undefined;
        this.disposed = false;
        this.rebuilding = false;
        this.pendingRebuild = false;
        this.onDidRebuildEmitter = new vscode.EventEmitter();
        this.onDidRebuild = this.onDidRebuildEmitter.event;
    }

    dispose() {
        this.disposed = true;
        if (this.rebuildTimer) {
            clearTimeout(this.rebuildTimer);
        }
        this.onDidRebuildEmitter.dispose();
    }

    scheduleRebuild() {
        if (this.disposed) {
            return;
        }

        const debounceMs = getConfig().get("index.debounceMs", 1200);
        if (this.rebuildTimer) {
            clearTimeout(this.rebuildTimer);
        }

        this.rebuildTimer = setTimeout(() => {
            this.rebuild();
        }, debounceMs);
    }

    async rebuild() {
        if (this.disposed) {
            return;
        }

        if (this.rebuilding) {
            this.pendingRebuild = true;
            return;
        }

        this.rebuilding = true;
        this.pendingRebuild = false;

        try {
            const nextSymbols = new Map();
            const nextDialogs = new Map();
            const nextColors = new Map();
            const files = await findPawnFiles();
            const openDocuments = new Map();

            for (const document of vscode.workspace.textDocuments) {
                if (isPawnDocument(document) && document.uri.scheme === "file") {
                    openDocuments.set(document.uri.toString(), document);
                }
            }

            for (const uri of files) {
                if (this.disposed) {
                    return;
                }

                let text;
                const openDocument = openDocuments.get(uri.toString());
                if (openDocument) {
                    text = openDocument.getText();
                } else {
                    try {
                        const bytes = await vscode.workspace.fs.readFile(uri);
                        text = Buffer.from(bytes).toString("utf8");
                    } catch (_) {
                        continue;
                    }
                }

                scanPawnText(uri, text, nextSymbols, nextDialogs, nextColors);
            }

            for (const document of openDocuments.values()) {
                if (!files.some((uri) => uri.toString() === document.uri.toString())) {
                    scanPawnText(document.uri, document.getText(), nextSymbols, nextDialogs, nextColors);
                }
            }

            this.symbols = nextSymbols;
            this.dialogs = nextDialogs;
            this.colors = nextColors;
            this.onDidRebuildEmitter.fire();
        } finally {
            this.rebuilding = false;
            if (this.pendingRebuild && !this.disposed) {
                this.scheduleRebuild();
            }
        }
    }

    getColor(name) {
        return this.colors.get(name);
    }

    findSymbol(name) {
        return this.symbols.get(name) || [];
    }

    findDialog(name) {
        return this.dialogs.get(name) || [];
    }
}

class ColorHighlighter {
    constructor(index) {
        this.index = index;
        this.decorationTypes = new Map();
        this.updateTimer = undefined;
        this.disposables = [];
        this.disposables.push(index.onDidRebuild(() => this.updateVisibleEditors()));
    }

    dispose() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        for (const decorationType of this.decorationTypes.values()) {
            decorationType.dispose();
        }

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    scheduleUpdate(document) {
        if (!isPawnDocument(document)) {
            return;
        }

        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        this.updateTimer = setTimeout(() => {
            this.updateVisibleEditors();
        }, 80);
    }

    updateVisibleEditors() {
        if (!getConfig().get("colors.enabled", true)) {
            for (const editor of vscode.window.visibleTextEditors) {
                this.clearEditor(editor);
            }
            return;
        }

        for (const editor of vscode.window.visibleTextEditors) {
            if (isPawnDocument(editor.document)) {
                this.updateEditor(editor);
            } else {
                this.clearEditor(editor);
            }
        }
    }

    updateEditor(editor) {
        const decorationsByColor = collectColorDecorations(editor.document, this.index);
        const usedColors = new Set(decorationsByColor.keys());

        for (const [hex, ranges] of decorationsByColor) {
            editor.setDecorations(this.getDecorationType(hex), ranges);
        }

        for (const [hex, decorationType] of this.decorationTypes) {
            if (!usedColors.has(hex)) {
                editor.setDecorations(decorationType, []);
            }
        }
    }

    clearEditor(editor) {
        for (const decorationType of this.decorationTypes.values()) {
            editor.setDecorations(decorationType, []);
        }
    }

    getDecorationType(hex) {
        let decorationType = this.decorationTypes.get(hex);
        if (decorationType) {
            return decorationType;
        }

        decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: `#${hex}`,
            color: contrastTextColor(hex),
            border: `1px solid ${borderColor(hex)}`,
            borderRadius: "2px",
            textDecoration: "none",
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
        this.decorationTypes.set(hex, decorationType);
        return decorationType;
    }
}

class PawnDefinitionProvider {
    constructor(index) {
        this.index = index;
        this.disposable = vscode.languages.registerDefinitionProvider(
            [
                { language: "pawn", scheme: "file" },
                { pattern: "**/*.{pwn,inc,module}", scheme: "file" }
            ],
            this
        );
    }

    dispose() {
        this.disposable.dispose();
    }

    provideDefinition(document, position) {
        if (!getConfig().get("definitions.enabled", true) || !isPawnDocument(document)) {
            return undefined;
        }

        const wordRange = document.getWordRangeAtPosition(position, IDENTIFIER_RE);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const context = getReferenceContext(document, wordRange);
        const localSymbols = findLocalDefinitions(document, word, position);
        let indexedSymbols = [];

        if (context.tag === "Dialog") {
            indexedSymbols = this.index.findDialog(word);
        } else if (context.declarationKind === "global" || context.declarationKind === "foreign") {
            const declarationName = context.declarationName || word;
            const targetKind = context.declarationKind === "global" ? "foreign" : "global-function";
            indexedSymbols = this.index.findSymbol(declarationName).filter((record) => record.kind === targetKind);
        } else {
            indexedSymbols = this.index.findSymbol(word);
            const globalFunctions = indexedSymbols.filter((record) => record.kind === "global-function");
            if (globalFunctions.length) {
                indexedSymbols = globalFunctions;
            }

            if (context.tag) {
                const dialogSymbols = this.index.findDialog(word);
                indexedSymbols = dialogSymbols.concat(indexedSymbols);
            }
        }

        const candidates = localSymbols.concat(indexedSymbols);
        if (!candidates.length) {
            return undefined;
        }

        return uniqueLocations(candidates)
            .sort(compareSymbolRecords)
            .map((record) => new vscode.Location(record.uri, record.range));
    }
}

async function findPawnFiles() {
    const config = getConfig();
    const include = config.get("index.include", [
        "gamemodes/**/*.{pwn,inc,module}",
        "pawno/include/**/*.{pwn,inc,module}",
        "*.{pwn,inc,module}"
    ]);
    const exclude = globUnion(config.get("index.exclude", [
        "**/.git/**",
        "**/.vs/**",
        "**/node_modules/**",
        "**/vscode-pawn-helper/**"
    ]));
    const maxFiles = config.get("index.maxFiles", 20000);
    const seen = new Map();

    for (const pattern of include) {
        const remaining = Math.max(0, maxFiles - seen.size);
        if (remaining === 0) {
            break;
        }

        const found = await vscode.workspace.findFiles(pattern, exclude, remaining);
        for (const uri of found) {
            seen.set(uri.toString(), uri);
        }
    }

    return Array.from(seen.values());
}

function scanPawnText(uri, text, symbols, dialogs, colors) {
    const lines = getLines(text);
    const commentState = { inBlock: false };
    const enumState = { active: false };
    let braceDepth = 0;

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        const code = maskStrings(stripped);
        const lineOffset = item.offset;
        const lineNumber = item.line;

        const defineMatch = stripped.match(/^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\b(.*)$/);
        if (defineMatch) {
            const name = defineMatch[1];
            const nameIndex = stripped.indexOf(name, defineMatch.index);
            addSymbol(symbols, name, "define", uri, lineNumber, nameIndex, nameIndex + name.length);

            const color = parseColorFromText(defineMatch[2], true);
            if (color) {
                colors.set(name, color);
            }
        }

        if (enumState.active) {
                parseEnumContent(stripped, uri, lineNumber, 0, symbols);
            if (code.includes("}")) {
                enumState.active = false;
            }
            braceDepth = updateBraceDepth(braceDepth, code);
            continue;
        }

        const enumMatch = stripped.match(/^\s*enum(?:\s+(?:(?:[A-Za-z_][A-Za-z0-9_]*|_)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*))?/);
        if (enumMatch) {
            const enumName = enumMatch[1];
            if (enumName) {
                const nameIndex = stripped.indexOf(enumName, enumMatch.index);
                addSymbol(symbols, enumName, "enum", uri, lineNumber, nameIndex, nameIndex + enumName.length);
            }

            const openIndex = stripped.indexOf("{");
            if (openIndex !== -1) {
                const afterOpen = stripped.slice(openIndex + 1);
                parseEnumContent(afterOpen, uri, lineNumber, openIndex + 1, symbols);
                enumState.active = !code.slice(openIndex + 1).includes("}");
            } else {
                enumState.active = true;
            }

            braceDepth = updateBraceDepth(braceDepth, code);
            continue;
        }

        if (braceDepth === 0) {
            const dialogMatch = stripped.match(/^\s*dialog\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
            if (dialogMatch) {
                const name = dialogMatch[1];
                const nameIndex = stripped.indexOf(name, dialogMatch.index);
                const record = makeRecord(name, "dialog", uri, lineNumber, nameIndex, nameIndex + name.length);
                addRecord(symbols, record);
                addRecord(dialogs, record);
            }

            const externalFunctionRecord = parseGlobalForeignFunction(stripped, uri, lineNumber);
            if (externalFunctionRecord) {
                addRecord(symbols, externalFunctionRecord);
            }

            const functionRecord = parseFunctionDefinition(stripped, code, uri, lineNumber);
            if (functionRecord) {
                addRecord(symbols, functionRecord);
            }

            for (const record of parseGlobalDeclarations(stripped, uri, lineNumber)) {
                addRecord(symbols, record);
            }
        }

        braceDepth = updateBraceDepth(braceDepth, code);
    }
}

function collectColorDecorations(document, index) {
    const text = document.getText();
    const decorations = new Map();

    addRegexColorDecorations(document, text, /\b0x([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?\b/g, 1, decorations);
    addRegexColorDecorations(document, text, /\{([0-9A-Fa-f]{6})\}/g, 1, decorations);
    addDefineBareColorDecorations(document, text, decorations);

    const namedColorRe = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
    let match;
    while ((match = namedColorRe.exec(text)) !== null) {
        const name = match[0];
        const color = index.getColor(name);
        if (!color) {
            continue;
        }

        addDecoration(decorations, color, document.positionAt(match.index), document.positionAt(match.index + name.length));
    }

    return decorations;
}

function addDefineBareColorDecorations(document, text, decorations) {
    const lines = getLines(text);
    const commentState = { inBlock: false };

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        const defineMatch = stripped.match(/^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\b(.*)$/);
        if (!defineMatch) {
            continue;
        }

        const body = defineMatch[2];
        const bodyOffset = item.offset + defineMatch.index + defineMatch[0].length - body.length;
        const bareColorRe = /(?:^|[^0-9A-Fa-fA-Za-z_{])([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?(?![0-9A-Fa-fA-Za-z_}])/g;
        let match;
        while ((match = bareColorRe.exec(body)) !== null) {
            const color = normalizeHex(match[1]);
            if (!color) {
                continue;
            }

            const startOffset = bodyOffset + match.index + match[0].indexOf(match[1]);
            addDecoration(
                decorations,
                color,
                document.positionAt(startOffset),
                document.positionAt(startOffset + match[1].length)
            );
        }
    }
}

function addRegexColorDecorations(document, text, regex, colorGroup, decorations) {
    let match;
    while ((match = regex.exec(text)) !== null) {
        const color = normalizeHex(match[colorGroup]);
        if (!color) {
            continue;
        }

        addDecoration(decorations, color, document.positionAt(match.index), document.positionAt(match.index + match[0].length));
    }
}

function addDecoration(decorations, color, start, end) {
    const range = new vscode.Range(start, end);
    const current = decorations.get(color);
    if (current) {
        current.push(range);
    } else {
        decorations.set(color, [range]);
    }
}

function parseFunctionDefinition(stripped, code, uri, lineNumber) {
    const match = stripped.match(/^\s*(?:(?:(stock|static|public|forward|native|hook|timer|ptask|task)\s+))*\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*(?:\{|$)/);
    if (!match) {
        return undefined;
    }

    const name = match[2];
    if (!name || CONTROL_WORDS.has(name)) {
        return undefined;
    }

    const prefix = stripped.slice(0, match.index + match[0].indexOf(name));
    const hasDefinitionKeyword = /\b(stock|static|public|forward|native|hook|timer|ptask|task)\b/.test(prefix);
    const afterParen = code.slice(match.index + match[0].length).trim();
    const isLikelyDefinition = hasDefinitionKeyword || match[0].trimEnd().endsWith("{") || afterParen === "";
    if (!isLikelyDefinition) {
        return undefined;
    }

    const nameIndex = stripped.indexOf(name, match.index);
    return makeRecord(name, "function", uri, lineNumber, nameIndex, nameIndex + name.length);
}

function parseGlobalForeignFunction(stripped, uri, lineNumber) {
    const match = stripped.match(/^\s*(global|foreign)\s+(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!match) {
        return undefined;
    }

    const keyword = match[1];
    const name = match[2];
    if (!name || CONTROL_WORDS.has(name)) {
        return undefined;
    }

    const nameIndex = stripped.indexOf(name, match.index + keyword.length);
    return makeRecord(name, keyword === "global" ? "global-function" : "foreign", uri, lineNumber, nameIndex, nameIndex + name.length);
}

function parseGlobalDeclarations(stripped, uri, lineNumber) {
    const declarations = [];
    const match = stripped.match(/^\s*(?:new|static|const)\b(.*)$/);
    if (!match) {
        return declarations;
    }

    const restStart = match.index + match[0].length - match[1].length;
    const segments = splitTopLevelSegments(match[1], restStart);
    for (const segment of segments) {
        const beforeAssign = segment.text.split("=")[0];
        const nameMatch = beforeAssign.match(/^\s*(?:(?:const|stock)\s+)*(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (!nameMatch) {
            continue;
        }

        const name = nameMatch[1];
        if (CONTROL_WORDS.has(name)) {
            continue;
        }

        const relativeNameIndex = beforeAssign.indexOf(name, nameMatch.index);
        const nameIndex = segment.offset + relativeNameIndex;
        declarations.push(makeRecord(name, "global", uri, lineNumber, nameIndex, nameIndex + name.length));
    }

    return declarations;
}

function parseEnumContent(content, uri, lineNumber, contentStartCharacter, symbols) {
    const cleanContent = content.replace(/[{};]/g, " ");
    const segments = splitTopLevelSegments(cleanContent, contentStartCharacter);

    for (const segment of segments) {
        const beforeAssign = segment.text.split("=")[0];
        const match = beforeAssign.match(/^\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*|_)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (!match) {
            continue;
        }

        const name = match[1];
        if (CONTROL_WORDS.has(name) || name === "enum") {
            continue;
        }

        const relativeNameIndex = beforeAssign.indexOf(name, match.index);
        const nameIndex = segment.offset + relativeNameIndex;
        addSymbol(symbols, name, "enum-member", uri, lineNumber, nameIndex, nameIndex + name.length);
    }
}

function findLocalDefinitions(document, word, position) {
    const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const lines = getLines(text);
    const records = [];
    const uri = document.uri;

    for (const item of lines) {
        const stripped = stripComments(item.text, { inBlock: false });
        const declarationRecords = parseGlobalDeclarations(stripped, uri, item.line)
            .filter((record) => record.name === word)
            .map((record) => ({ ...record, kind: "local" }));
        records.push(...declarationRecords);

        const functionRecord = parseFunctionDefinition(stripped, maskStrings(stripped), uri, item.line);
        if (functionRecord) {
            for (const record of parseFunctionParameters(stripped, functionRecord, uri, item.line)) {
                if (record.name === word) {
                    records.push(record);
                }
            }
        }
    }

    return records.slice(-8).reverse();
}

function parseFunctionParameters(line, functionRecord, uri, lineNumber) {
    const records = [];
    const open = line.indexOf("(", functionRecord.range.end.character);
    const close = line.lastIndexOf(")");
    if (open === -1 || close === -1 || close <= open) {
        return records;
    }

    const params = line.slice(open + 1, close);
    const segments = splitTopLevelSegments(params, open + 1);
    for (const segment of segments) {
        const left = segment.text.split("=")[0];
        const match = left.match(/^\s*(?:(?:const)\s+)?(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (!match) {
            continue;
        }

        const name = match[1];
        const relativeNameIndex = left.indexOf(name, match.index);
        const nameIndex = segment.offset + relativeNameIndex;
        records.push(makeRecord(name, "local", uri, lineNumber, nameIndex, nameIndex + name.length));
    }

    return records;
}

function getReferenceContext(document, wordRange) {
    const line = document.lineAt(wordRange.start.line).text;
    const beforeWord = line.slice(0, wordRange.start.character);
    const tagMatch = beforeWord.match(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    const externalDeclaration = getGlobalForeignDeclarationContext(line, wordRange);
    return {
        tag: tagMatch ? tagMatch[1] : undefined,
        declarationKind: externalDeclaration ? externalDeclaration.kind : undefined,
        declarationName: externalDeclaration ? externalDeclaration.name : undefined
    };
}

function getGlobalForeignDeclarationContext(line, wordRange) {
    const match = line.match(/^\s*(global|foreign)\s+(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!match) {
        return undefined;
    }

    const keyword = match[1];
    const name = match[2];
    const keywordStart = line.indexOf(keyword, match.index);
    const nameStart = line.indexOf(name, keywordStart + keyword.length);
    const cursorStart = wordRange.start.character;
    const cursorEnd = wordRange.end.character;
    const onKeyword = cursorStart >= keywordStart && cursorEnd <= keywordStart + keyword.length;
    const onName = cursorStart >= nameStart && cursorEnd <= nameStart + name.length;
    if (!onKeyword && !onName) {
        return undefined;
    }

    return { kind: keyword, name };
}

function addSymbol(map, name, kind, uri, lineNumber, startCharacter, endCharacter) {
    addRecord(map, makeRecord(name, kind, uri, lineNumber, startCharacter, endCharacter));
}

function addRecord(map, record) {
    const current = map.get(record.name);
    if (current) {
        current.push(record);
    } else {
        map.set(record.name, [record]);
    }
}

function makeRecord(name, kind, uri, lineNumber, startCharacter, endCharacter) {
    return {
        name,
        kind,
        uri,
        range: new vscode.Range(
            new vscode.Position(lineNumber, Math.max(0, startCharacter)),
            new vscode.Position(lineNumber, Math.max(0, endCharacter))
        )
    };
}

function uniqueLocations(records) {
    const seen = new Set();
    const result = [];

    for (const record of records) {
        const key = `${record.uri.toString()}:${record.range.start.line}:${record.range.start.character}:${record.kind}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(record);
    }

    return result;
}

function compareSymbolRecords(a, b) {
    const rankA = SYMBOL_KIND_RANK.get(a.kind) ?? 99;
    const rankB = SYMBOL_KIND_RANK.get(b.kind) ?? 99;
    if (rankA !== rankB) {
        return rankA - rankB;
    }

    const fileCompare = a.uri.fsPath.localeCompare(b.uri.fsPath);
    if (fileCompare !== 0) {
        return fileCompare;
    }

    return a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character;
}

function parseColorFromText(text, allowBareHex) {
    const braceMatch = text.match(/\{([0-9A-Fa-f]{6})\}/);
    if (braceMatch) {
        return normalizeHex(braceMatch[1]);
    }

    const hexMatch = text.match(/\b0x([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?\b/);
    if (hexMatch) {
        return normalizeHex(hexMatch[1]);
    }

    if (allowBareHex) {
        const bareHexMatch = text.match(/(?:^|[^0-9A-Fa-fA-Za-z_{])([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?(?![0-9A-Fa-fA-Za-z_}])/);
        if (bareHexMatch) {
            return normalizeHex(bareHexMatch[1]);
        }
    }

    return undefined;
}

function normalizeHex(value) {
    if (!value || !/^[0-9A-Fa-f]{6}$/.test(value)) {
        return undefined;
    }

    return value.toUpperCase();
}

function contrastTextColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const luminance = (0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b));
    return luminance > 0.48 ? "#000000" : "#FFFFFF";
}

function borderColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const luminance = (0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b));
    return luminance > 0.48 ? "rgba(0, 0, 0, 0.30)" : "rgba(255, 255, 255, 0.35)";
}

function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
    };
}

function srgb(value) {
    const normalized = value / 255;
    return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function stripComments(line, state) {
    let result = "";
    let inString = false;
    let quote = "";

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];

        if (state.inBlock) {
            if (char === "*" && next === "/") {
                result += "  ";
                index++;
                state.inBlock = false;
            } else {
                result += " ";
            }
            continue;
        }

        if (inString) {
            result += char;
            if (char === "\\" && next) {
                result += next;
                index++;
            } else if (char === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }

        if (char === "\"" || char === "'") {
            inString = true;
            quote = char;
            result += char;
            continue;
        }

        if (char === "/" && next === "/") {
            result += " ".repeat(line.length - index);
            break;
        }

        if (char === "/" && next === "*") {
            result += "  ";
            index++;
            state.inBlock = true;
            continue;
        }

        result += char;
    }

    return result;
}

function maskStrings(line) {
    let result = "";
    let inString = false;
    let quote = "";

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];

        if (inString) {
            result += " ";
            if (char === "\\" && next) {
                result += " ";
                index++;
            } else if (char === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }

        if (char === "\"" || char === "'") {
            inString = true;
            quote = char;
            result += " ";
            continue;
        }

        result += char;
    }

    return result;
}

function updateBraceDepth(currentDepth, code) {
    let depth = currentDepth;
    for (const char of code) {
        if (char === "{") {
            depth++;
        } else if (char === "}") {
            depth = Math.max(0, depth - 1);
        }
    }

    return depth;
}

function splitTopLevelSegments(text, absoluteOffset) {
    const segments = [];
    let start = 0;
    let squareDepth = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let quote = "";

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];

        if (inString) {
            if (char === "\\" && next) {
                index++;
            } else if (char === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }

        if (char === "\"" || char === "'") {
            inString = true;
            quote = char;
            continue;
        }

        if (char === "[") {
            squareDepth++;
        } else if (char === "]") {
            squareDepth = Math.max(0, squareDepth - 1);
        } else if (char === "(") {
            parenDepth++;
        } else if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
        } else if (char === "{") {
            braceDepth++;
        } else if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
        } else if (char === "," && squareDepth === 0 && parenDepth === 0 && braceDepth === 0) {
            segments.push({ text: text.slice(start, index), offset: absoluteOffset + start });
            start = index + 1;
        }
    }

    segments.push({ text: text.slice(start), offset: absoluteOffset + start });
    return segments.filter((segment) => segment.text.trim().length > 0);
}

function getLines(text) {
    const lines = [];
    let offset = 0;
    let lineNumber = 0;

    while (offset < text.length) {
        const newline = text.indexOf("\n", offset);
        if (newline === -1) {
            let value = text.slice(offset);
            if (value.endsWith("\r")) {
                value = value.slice(0, -1);
            }
            lines.push({ text: value, offset, line: lineNumber });
            break;
        }

        let value = text.slice(offset, newline);
        if (value.endsWith("\r")) {
            value = value.slice(0, -1);
        }
        lines.push({ text: value, offset, line: lineNumber });
        offset = newline + 1;
        lineNumber++;
    }

    if (text.length === 0) {
        lines.push({ text: "", offset: 0, line: 0 });
    }

    return lines;
}

function globUnion(patterns) {
    if (!patterns || !patterns.length) {
        return undefined;
    }

    if (patterns.length === 1) {
        return patterns[0];
    }

    return `{${patterns.join(",")}}`;
}

function getConfig() {
    return vscode.workspace.getConfiguration("livePawnHelper");
}

function isPawnDocument(document) {
    if (!document) {
        return false;
    }

    return document.languageId === "pawn" || /\.(pwn|inc|module)$/i.test(document.fileName);
}

module.exports = {
    activate,
    deactivate
};
