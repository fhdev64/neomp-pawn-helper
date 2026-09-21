"use strict";

const vscode = require("vscode");
const path = require("path");
const { TextDecoder } = require("util");

const PAWN_IDENTIFIER_SOURCE = "[A-Za-z_][A-Za-z0-9_]*";
const PAWN_SYMBOL_SOURCE = `${PAWN_IDENTIFIER_SOURCE}(?:::${PAWN_IDENTIFIER_SOURCE})?`;
const PAWN_SYMBOL_RE = new RegExp(PAWN_SYMBOL_SOURCE, "g");
const PAWN_NAMESPACE_RE = new RegExp(`\\b(${PAWN_IDENTIFIER_SOURCE})::(${PAWN_IDENTIFIER_SOURCE})\\b`, "g");
const FUNCTION_KEYWORDS_SOURCE = "stock|static|public|forward|native|hook|timer|ptask|task";
const EXTERNAL_FUNCTION_KEYWORDS_SOURCE = "global|foreign";
const ALL_FUNCTION_KEYWORDS_SOURCE = `${FUNCTION_KEYWORDS_SOURCE}|${EXTERNAL_FUNCTION_KEYWORDS_SOURCE}`;
const FUNCTION_HEADER_RE = new RegExp(`^\\s*((?:(?:${ALL_FUNCTION_KEYWORDS_SOURCE})\\s+)*)((?:${PAWN_IDENTIFIER_SOURCE})\\s*:\\s*|(?:${PAWN_IDENTIFIER_SOURCE})\\s+)?(${PAWN_SYMBOL_SOURCE})\\s*\\(`);
const OOP_MEMBER_MODIFIERS_SOURCE = "public|protected|private|static|property|readonly|virtual|override|abstract|final";
const PAWN_CLASS_DECL_RE = new RegExp(`^\\s*(?:(abstract|final)\\s+)?class\\s+(${PAWN_IDENTIFIER_SOURCE})(?:\\s*\\[[^\\]]*\\])?(?:\\s*(extends|:)\\s*(${PAWN_IDENTIFIER_SOURCE}))?\\s*(?:\\{|$)`);
const PAWN_NEW_CLASS_RE = new RegExp(`\\bnew\\s+(${PAWN_IDENTIFIER_SOURCE})\\s*\\(`, "g");
const OOP_THIS_DEFINE_RE = new RegExp(`^\\s*#\\s*define\\s+this\\.\\s+THIS__\\s*\\(\\s*(${PAWN_IDENTIFIER_SOURCE})\\s*\\)`);
const OOP_THIS_UNDEF_RE = /^\s*#\s*undef\s+this\b/;
const PAWN_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const PAWN_FILE_DECODER = new TextDecoder("windows-1251");
const PAWN_SEMANTIC_TYPES = ["namespace", "function", "class", "property", "method", "variable", "parameter", "keyword", "type"];
const PAWN_SEMANTIC_TYPE_INDEX = new Map(PAWN_SEMANTIC_TYPES.map((type, index) => [type, index]));
const PAWN_SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(PAWN_SEMANTIC_TYPES, []);
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
    ["class-constructor", 1],
    ["class-method", 2],
    ["class-field", 3],
    ["class", 4],
    ["class-var", 5],
    ["enum-member", 6],
    ["define", 7],
    ["mysql-callback", 7],
    ["global-function", 8],
    ["function", 9],
    ["foreign", 10],
    ["global", 11],
    ["enum", 12],
    ["local", 13]
]);
const PAWN_BUILTIN_TYPES = new Set([
    "bool",
    "char",
    "DB",
    "DBResult",
    "File",
    "float",
    "Float",
    "int",
    "String",
    "va_args",
    "void"
]);
const PAWN_VALUE_HINT_RESERVED = new Set([
    ...PAWN_BUILTIN_TYPES,
    ...CONTROL_WORDS,
    "abstract",
    "base",
    "class",
    "extends",
    "final",
    "foreign",
    "global",
    "hook",
    "native",
    "new",
    "owned",
    "private",
    "property",
    "protected",
    "public",
    "readonly",
    "static",
    "stock",
    "virtual",
    "override"
]);
const OOP_HELPER_MEMBERS = new Set(["Alloc", "Delete", "IsValid", "Is", "Cast"]);
const MYSQL_QUERY_FUNCTIONS = new Set([
    "mysql_format",
    "mysql_query",
    "mysql_tquery",
    "mysql_pquery",
    "mysql_function_query"
]);
const SQL_QUERY_FUNCTIONS = new Set([
    ...MYSQL_QUERY_FUNCTIONS,
    "format"
]);
const MYSQL_CALLBACK_ARGUMENT = new Map([
    ["mysql_tquery", 2],
    ["mysql_pquery", 2],
    ["mysql_function_query", 3]
]);
const SQL_KEYWORD_RE = /\b(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|FROM|INTO|VALUES|VALUE|SET|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|ORDER|BY|LIMIT|OFFSET|HAVING|AS|AND|OR|NOT|NULL|IS|LIKE|IN|BETWEEN|PRIMARY|KEY|FOREIGN|REFERENCES|TABLE|DATABASE|INDEX|UNIQUE|DEFAULT|AUTO_INCREMENT)\b/gi;
const SQL_START_RE = /\b(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)\b/i;
const SQL_CONTEXT_RE = /\b(FROM|INTO|VALUES|SET|WHERE|TABLE|JOIN|PRIMARY\s+KEY|AUTO_INCREMENT)\b/i;
const MYSQL_FORMAT_SPECIFIERS = new Set(["b", "c", "d", "e", "f", "i", "s", "x"]);
const MYSQL_FORMAT_SPECIFIER_LABEL = "%b/%c/%d/%e/%f/%i/%s/%x";
const SQL_SNIPPET_DEFINITIONS = [
    {
        keyword: "INSERT",
        label: "INSERT INTO ... VALUES",
        detail: "SQL INSERT template with value arguments",
        snippet: "INSERT INTO `${1:table_name}` (`${2:field_1}`, `${3:field_2}`, `${4:field_3}`) VALUES (%i, %i, %i){{QUOTE}}, ${5:var1}, ${6:var2}, ${7:var3}$0"
    },
    {
        keyword: "UPDATE",
        label: "UPDATE ... SET ... WHERE",
        detail: "SQL UPDATE template with value arguments",
        snippet: "UPDATE `${1:table_name}` SET `${2:field_1}` = %i, `${3:field_2}` = %i, `${4:field_3}` = %i WHERE `${5:id}` = %i{{QUOTE}}, ${6:var1}, ${7:var2}, ${8:var3}, ${9:id}$0"
    },
    {
        keyword: "DELETE",
        label: "DELETE FROM ... WHERE",
        detail: "SQL DELETE template with value argument",
        snippet: "DELETE FROM `${1:table_name}` WHERE `${2:id}` = %i{{QUOTE}}, ${3:id}$0"
    },
    {
        keyword: "SELECT",
        label: "SELECT ... FROM ... WHERE",
        detail: "SQL SELECT template with value argument",
        snippet: "SELECT `${1:field_1}`, `${2:field_2}`, `${3:field_3}` FROM `${4:table_name}` WHERE `${5:id}` = %i{{QUOTE}}, ${6:id}$0"
    }
];

function activate(context) {
    const index = new PawnIndex();
    const highlighter = new ColorHighlighter(index);
    const numericValueHints = new NumericValueHintProvider(index);
    const sqlHighlighter = new SqlHighlighter();
    const mysqlDiagnostics = new MysqlDiagnostics();
    const semanticProvider = new PawnSemanticProvider(index);
    const definitionProvider = new PawnDefinitionProvider(index);
    const referenceProvider = new PawnReferenceProvider(index);
    const includeLinkProvider = new PawnIncludeLinkProvider();
    const sqlSnippetCompletionProvider = new SqlSnippetCompletionProvider();
    const oopCompletionProvider = new PawnOopCompletionProvider(index);
    const hoverProvider = new PawnHoverProvider(index);

    context.subscriptions.push(index, highlighter, numericValueHints, sqlHighlighter, mysqlDiagnostics, semanticProvider, definitionProvider, referenceProvider, includeLinkProvider, sqlSnippetCompletionProvider, oopCompletionProvider, hoverProvider);
    context.subscriptions.push(vscode.commands.registerCommand("neoPawnHelper.reindex", async () => {
        await index.rebuild();
        highlighter.updateVisibleEditors();
        sqlHighlighter.updateVisibleEditors();
        mysqlDiagnostics.updateOpenDocuments();
        vscode.window.setStatusBarMessage("NeoPawn Helper: проект переиндексирован", 2500);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("neoPawnHelper.generateEnumFromCreateTable", () => {
        generateEnumFromCreateTableCommand();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("neoPawnHelper.openIncludePath", async (target) => {
        await openIncludePath(target);
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (
            event.affectsConfiguration("neoPawnHelper.index") ||
            event.affectsConfiguration("neoPawnHelper.colors") ||
            event.affectsConfiguration("neoPawnHelper.constants") ||
            event.affectsConfiguration("neoPawnHelper.sql") ||
            event.affectsConfiguration("neoPawnHelper.definitions")
        ) {
            index.scheduleRebuild();
            numericValueHints.refresh();
            highlighter.updateVisibleEditors();
            sqlHighlighter.updateVisibleEditors();
            mysqlDiagnostics.updateOpenDocuments();
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (!isPawnDocument(event.document)) {
            return;
        }

        highlighter.scheduleUpdate(event.document);
        numericValueHints.scheduleRefresh();
        sqlHighlighter.scheduleUpdate(event.document);
        mysqlDiagnostics.scheduleUpdate(event.document);
        maybeTriggerSqlSnippetSuggest(event);
        index.scheduleDocumentUpdate(event.document);
    }));

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        if (isPawnDocument(document)) {
            index.scheduleDocumentUpdate(document);
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        if (isPawnDocument(document)) {
            highlighter.scheduleUpdate(document);
            sqlHighlighter.scheduleUpdate(document);
            mysqlDiagnostics.scheduleUpdate(document);
            index.scheduleDocumentUpdate(document);
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => index.scheduleRebuild()));
    context.subscriptions.push(vscode.workspace.onDidCreateFiles(() => index.scheduleRebuild()));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(() => index.scheduleRebuild()));
    context.subscriptions.push(vscode.workspace.onDidRenameFiles(() => index.scheduleRebuild()));

    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
        highlighter.updateVisibleEditors();
        sqlHighlighter.updateVisibleEditors();
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            highlighter.scheduleUpdate(editor.document);
            sqlHighlighter.scheduleUpdate(editor.document);
        }
    }));

    index.rebuild().then(() => {
        highlighter.updateVisibleEditors();
        sqlHighlighter.updateVisibleEditors();
        mysqlDiagnostics.updateOpenDocuments();
    });
}

function deactivate() {}

class PawnIndex {
    constructor() {
        this.symbols = new Map();
        this.dialogs = new Map();
        this.colors = new Map();
        this.numericValues = new Map();
        this.mysqlCallbacks = new Map();
        this.classes = new Map();
        this.classParents = new Map();
        this.classMembers = new Map();
        this.classVariables = new Map();
        this.fileEntries = new Map();
        this.rebuildTimer = undefined;
        this.documentUpdateTimers = new Map();
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
        for (const timer of this.documentUpdateTimers.values()) {
            clearTimeout(timer);
        }
        this.documentUpdateTimers.clear();
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
            this.rebuildTimer = undefined;
            this.rebuild();
        }, debounceMs);
    }

    scheduleDocumentUpdate(document) {
        if (this.disposed || !isPawnDocument(document) || document.uri.scheme !== "file") {
            return;
        }

        const key = document.uri.toString();
        const currentTimer = this.documentUpdateTimers.get(key);
        if (currentTimer) {
            clearTimeout(currentTimer);
        }

        const debounceMs = getConfig().get("index.documentDebounceMs", 250);
        const timer = setTimeout(() => {
            this.documentUpdateTimers.delete(key);
            this.updateDocument(document);
        }, debounceMs);
        this.documentUpdateTimers.set(key, timer);
    }

    updateDocument(document) {
        if (this.disposed || !isPawnDocument(document) || document.uri.scheme !== "file") {
            return;
        }

        this.setFileEntry(document.uri, scanPawnTextToEntry(document.uri, document.getText()));
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
            const nextEntries = new Map();
            const files = await findPawnFiles();
            const fileKeys = new Set(files.map((uri) => uri.toString()));
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
                        text = decodePawnBytes(bytes);
                    } catch (_) {
                        continue;
                    }
                }

                nextEntries.set(uri.toString(), scanPawnTextToEntry(uri, text));
            }

            for (const document of openDocuments.values()) {
                if (!fileKeys.has(document.uri.toString())) {
                    nextEntries.set(document.uri.toString(), scanPawnTextToEntry(document.uri, document.getText()));
                }
            }

            this.fileEntries = nextEntries;
            this.rebuildIndexesFromEntries();
            this.onDidRebuildEmitter.fire();
        } finally {
            this.rebuilding = false;
            if (this.pendingRebuild && !this.disposed) {
                this.scheduleRebuild();
            }
        }
    }

    setFileEntry(uri, entry) {
        this.fileEntries.set(uri.toString(), entry);
        this.rebuildIndexesFromEntries();
        this.onDidRebuildEmitter.fire();
    }

    rebuildIndexesFromEntries() {
        const nextSymbols = new Map();
        const nextDialogs = new Map();
        const nextColors = new Map();
        const nextNumericValues = new Map();
        const nextMysqlCallbacks = new Map();
        const nextClasses = new Map();
        const nextClassParents = new Map();
        const nextClassMembers = new Map();
        const classVariableCandidates = new Map();
        const nextClassVariables = new Map();

        for (const entry of this.fileEntries.values()) {
            mergeRecordMap(nextSymbols, entry.symbols);
            mergeRecordMap(nextDialogs, entry.dialogs);
            mergeColorMap(nextColors, entry.colors);
            mergeNumericValueMap(nextNumericValues, entry.numericValues);
            mergeRecordMap(nextMysqlCallbacks, entry.mysqlCallbacks);
            mergeRecordMap(nextClasses, entry.classes);
            for (const [className, parent] of entry.classParents) {
                nextClassParents.set(className, parent);
            }
            mergeKeyedRecordMap(nextClassMembers, entry.classMembers);
            mergeRecordMap(classVariableCandidates, entry.classVariables);
        }

        for (const records of classVariableCandidates.values()) {
            for (const record of records) {
                if (!nextClasses.has(record.className)) {
                    continue;
                }

                addRecord(nextClassVariables, record);
                addRecord(nextSymbols, record);
            }
        }

        this.symbols = nextSymbols;
        this.dialogs = nextDialogs;
        this.colors = nextColors;
        this.numericValues = nextNumericValues;
        this.mysqlCallbacks = nextMysqlCallbacks;
        this.classes = nextClasses;
        this.classParents = nextClassParents;
        this.classMembers = nextClassMembers;
        this.classVariables = nextClassVariables;
    }

    getColor(name) {
        return this.colors.get(name);
    }

    getNumericValue(name) {
        const value = this.numericValues.get(name);
        return value?.ambiguous ? undefined : value;
    }

    findSymbol(name) {
        return this.symbols.get(name) || [];
    }

    findDialog(name) {
        return this.dialogs.get(name) || [];
    }

    findMysqlCallback(name) {
        return this.mysqlCallbacks.get(name) || [];
    }

    findClass(name) {
        return this.classes.get(name) || [];
    }

    findClasses() {
        return Array.from(this.classes.entries()).map(([name, records]) => ({ name, records }));
    }

    findClassMember(className, memberName) {
        const records = [];
        const visited = new Set();
        for (let current = className; current && !visited.has(current); current = this.classParents.get(current)?.name) {
            visited.add(current);
            records.push(...(this.classMembers.get(makeClassMemberKey(current, memberName)) || []));
        }
        return records;
    }

    findClassMembers(className) {
        const records = [];
        const visited = new Set();
        for (let current = className; current && !visited.has(current); current = this.classParents.get(current)?.name) {
            visited.add(current);
            const prefix = `${current}.`;
            for (const [key, members] of this.classMembers) {
                if (key.startsWith(prefix)) {
                    records.push(...members);
                }
            }
        }
        return records;
    }

    findClassParent(className) {
        return this.classParents.get(className);
    }

    findClassVariable(name) {
        return this.classVariables.get(name) || [];
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

class NumericValueHintProvider {
    constructor(index) {
        this.index = index;
        this.refreshTimer = undefined;
        this.onDidChangeInlayHintsEmitter = new vscode.EventEmitter();
        this.onDidChangeInlayHints = this.onDidChangeInlayHintsEmitter.event;
        this.disposables = [
            vscode.languages.registerInlayHintsProvider({ language: "pawn" }, this),
            index.onDidRebuild(() => this.refresh())
        ];
    }

    dispose() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.onDidChangeInlayHintsEmitter.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    scheduleRefresh() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            this.refresh();
        }, 150);
    }

    refresh() {
        this.onDidChangeInlayHintsEmitter.fire();
    }

    provideInlayHints(document, range) {
        if (!isPawnDocument(document) || !getConfig().get("constants.valueHints.enabled", true)) {
            return [];
        }

        return collectNumericValueHints(document, range, this.index);
    }
}

class SqlHighlighter {
    constructor() {
        this.updateTimer = undefined;
        this.keywordDecoration = vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor("symbolIcon.keywordForeground"),
            fontWeight: "bold",
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
        this.placeholderDecoration = vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor("editorWarning.foreground"),
            fontWeight: "bold",
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
    }

    dispose() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        this.keywordDecoration.dispose();
        this.placeholderDecoration.dispose();
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
        if (!getConfig().get("sql.highlighting.enabled", true)) {
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
        const decorations = collectSqlDecorations(editor.document);
        editor.setDecorations(this.keywordDecoration, decorations.keywords);
        editor.setDecorations(this.placeholderDecoration, decorations.placeholders);
    }

    clearEditor(editor) {
        editor.setDecorations(this.keywordDecoration, []);
        editor.setDecorations(this.placeholderDecoration, []);
    }
}

class PawnSemanticProvider {
    constructor(index) {
        this.index = index;
        this.onDidChangeSemanticTokensEmitter = new vscode.EventEmitter();
        this.onDidChangeSemanticTokens = this.onDidChangeSemanticTokensEmitter.event;
        this.disposables = [
            vscode.languages.registerDocumentSemanticTokensProvider(
                [
                    { language: "pawn" },
                    { pattern: "**/*.{pwn,inc,module}" }
                ],
                this,
                PAWN_SEMANTIC_LEGEND
            ),
            index.onDidRebuild(() => this.onDidChangeSemanticTokensEmitter.fire())
        ];
    }

    dispose() {
        this.onDidChangeSemanticTokensEmitter.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    provideDocumentSemanticTokens(document) {
        if (!isPawnDocument(document)) {
            return new vscode.SemanticTokens(new Uint32Array());
        }

        return buildPawnSemanticTokens(document, this.index);
    }
}

class MysqlDiagnostics {
    constructor() {
        this.collection = vscode.languages.createDiagnosticCollection("pawn-helper-mysql");
        this.updateTimer = undefined;
    }

    dispose() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        this.collection.dispose();
    }

    scheduleUpdate(document) {
        if (!isPawnDocument(document)) {
            return;
        }

        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        this.updateTimer = setTimeout(() => {
            this.updateDocument(document);
        }, 150);
    }

    updateOpenDocuments() {
        if (!getConfig().get("sql.diagnostics.enabled", true)) {
            this.collection.clear();
            return;
        }

        for (const document of vscode.workspace.textDocuments) {
            if (isPawnDocument(document)) {
                this.updateDocument(document);
            }
        }
    }

    updateDocument(document) {
        if (!getConfig().get("sql.diagnostics.enabled", true) || !isPawnDocument(document)) {
            this.collection.delete(document.uri);
            return;
        }

        this.collection.set(document.uri, collectMysqlDiagnostics(document));
    }
}

class SqlSnippetCompletionProvider {
    constructor() {
        this.disposable = vscode.languages.registerCompletionItemProvider(
            [
                { language: "pawn", scheme: "file" },
                { pattern: "**/*.{pwn,inc,module}", scheme: "file" }
            ],
            this,
            " ",
            "T",
            "t",
            "E",
            "e"
        );
    }

    dispose() {
        this.disposable.dispose();
    }

    provideCompletionItems(document, position) {
        if (!isPawnDocument(document)) {
            return undefined;
        }

        const context = getSqlSnippetContext(document, position);
        if (!context) {
            return undefined;
        }

        return context.definitions.map((definition, index) => {
            const item = new vscode.CompletionItem(definition.label, vscode.CompletionItemKind.Text);
            item.detail = definition.detail;
            item.filterText = definition.keyword;
            item.sortText = `0_${index}_${definition.keyword}`;
            item.preselect = definition.keyword === context.typedKeyword;
            item.range = context.range;
            item.insertText = new vscode.SnippetString(definition.snippet.replace(/\{\{QUOTE\}\}/g, context.quote));
            if (context.deleteRange) {
                item.additionalTextEdits = [vscode.TextEdit.delete(context.deleteRange)];
            }
            item.documentation = new vscode.MarkdownString(`Expands ${definition.keyword} into a Pawn SQL query template.`);
            return item;
        });
    }
}

class PawnOopCompletionProvider {
    constructor(index) {
        this.index = index;
        this.disposable = vscode.languages.registerCompletionItemProvider(
            [
                { language: "pawn", scheme: "file" },
                { pattern: "**/*.{pwn,inc,module}", scheme: "file" }
            ],
            this,
            ".",
            " "
        );
    }

    dispose() {
        this.disposable.dispose();
    }

    provideCompletionItems(document, position) {
        if (!isPawnDocument(document)) {
            return undefined;
        }

        const line = document.lineAt(position.line).text.slice(0, position.character);
        const newMatch = line.match(/\bnew\s+([A-Za-z_][A-Za-z0-9_]*)?$/);
        if (newMatch) {
            return this.index.findClasses().map(({ name }) => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
                item.detail = "Класс NeoPawn";
                item.insertText = new vscode.SnippetString(`${name}($0)`);
                return item;
            });
        }

        const dot = line.lastIndexOf(".");
        if (dot === -1) {
            return undefined;
        }

        const className = resolveMemberAccessClassName(document, line.slice(0, dot + 1), position, this.index);
        if (!className) {
            return undefined;
        }

        const seen = new Set();
        const items = [];
        for (const record of this.index.findClassMembers(className)) {
            if (seen.has(record.name) || record.kind === "class-constructor" || record.kind === "class-destructor") {
                continue;
            }
            seen.add(record.name);
            const callable = record.kind !== "class-field";
            const item = new vscode.CompletionItem(
                record.name,
                callable ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Field
            );
            item.detail = record.signature || `${record.className}.${record.name}`;
            item.insertText = callable ? new vscode.SnippetString(`${record.name}($0)`) : record.name;
            items.push(item);
        }

        const ownerMatch = line.slice(0, dot).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
        const staticAccess = ownerMatch && isKnownPawnClass(this.index, ownerMatch[1]);
        for (const name of staticAccess ? ["Is", "Cast"] : ["Delete", "IsValid"]) {
            if (seen.has(name)) {
                continue;
            }
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
            item.detail = "Встроенный метод NeoPawn";
            item.insertText = new vscode.SnippetString(`${name}($0)`);
            items.push(item);
        }
        return items;
    }
}

class PawnHoverProvider {
    constructor(index) {
        this.index = index;
        this.disposable = vscode.languages.registerHoverProvider(
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

    provideHover(document, position) {
        const range = getPawnSymbolRangeAtPosition(document, position);
        if (!range) {
            return undefined;
        }

        const word = document.getText(range);
        const context = getPawnClassReferenceContext(document, range, word, this.index);
        if (!context) {
            return undefined;
        }

        if (context.kind === "class") {
            const parent = this.index.findClassParent(context.className);
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(
                parent ? `class ${context.className} extends ${parent.name}` : `class ${context.className}`,
                "pawn"
            );
            return new vscode.Hover(markdown, context.originRange);
        }

        const record = this.index.findClassMember(context.className, context.memberName)[0];
        if (!record) {
            if (OOP_HELPER_MEMBERS.has(context.memberName)) {
                const signatures = {
                    Delete: "void Delete()",
                    IsValid: "bool IsValid()",
                    Is: `bool ${context.className}.Is(${context.className} value)`,
                    Cast: `${context.className} ${context.className}.Cast(${context.className} value)`
                };
                const markdown = new vscode.MarkdownString();
                markdown.appendCodeblock(signatures[context.memberName], "pawn");
                markdown.appendMarkdown("\n\nВстроенный метод NeoPawn.");
                return new vscode.Hover(markdown, context.originRange);
            }
            return undefined;
        }

        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(record.signature || `${record.className}.${record.name}`, "pawn");
        if (record.className !== context.className) {
            markdown.appendMarkdown(`\n\nУнаследовано от \`${record.className}\`.`);
        }
        return new vscode.Hover(markdown, context.originRange);
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

        const wordRange = getPawnSymbolRangeAtPosition(document, position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const classContext = getPawnClassReferenceContext(document, wordRange, word, this.index);
        if (classContext) {
            const classSymbols = this.findPawnClassDefinitions(classContext);
            if (classSymbols.length) {
                return uniqueLocations(classSymbols)
                    .sort(compareSymbolRecords)
                    .map((record) => makeDefinitionLink(record, classContext.originRange));
            }
        }

        const context = getReferenceContext(document, wordRange);
        const oopContext = getThisMethodCallContext(document, wordRange, word);
        if (oopContext) {
            const oopSymbols = this.findOopMethodDefinitions(oopContext.tag, oopContext.method);
            if (oopSymbols.length) {
                return uniqueLocations(oopSymbols)
                    .sort(compareSymbolRecords)
                    .map((record) => makeDefinitionLink(record, oopContext.originRange));
            }
        }

        const localSymbols = findLocalDefinitions(document, word, position, this.index);
        const callbackReferences = context.functionDeclarationName === word ? this.index.findMysqlCallback(word) : [];
        let indexedSymbols = [];

        if (context.tag === "Dialog") {
            indexedSymbols = this.index.findDialog(word);
        } else if (context.declarationKind === "global" || context.declarationKind === "foreign") {
            const declarationName = context.declarationName || word;
            const targetKind = context.declarationKind === "global" ? "foreign" : "global-function";
            indexedSymbols = this.index.findSymbol(declarationName).filter((record) => record.kind === targetKind);
        } else {
            indexedSymbols = this.findNamespacedAliasDefinitions(word);
            if (!indexedSymbols.length) {
                indexedSymbols = this.index.findSymbol(word);
            }

            const globalFunctions = indexedSymbols.filter((record) => record.kind === "global-function");
            if (globalFunctions.length) {
                indexedSymbols = globalFunctions;
            }

            if (context.tag) {
                const dialogSymbols = this.index.findDialog(word);
                indexedSymbols = dialogSymbols.concat(indexedSymbols);
            }
        }

        const candidates = callbackReferences.concat(localSymbols, indexedSymbols);
        if (!candidates.length) {
            return undefined;
        }

        return uniqueLocations(candidates)
            .sort(compareSymbolRecords)
            .map((record) => makeDefinitionLink(record, wordRange));
    }

    findOopMethodDefinitions(tag, method) {
        const classMethods = this.index.findClassMember(tag, method).filter((record) => record.kind !== "class-field");
        if (classMethods.length) {
            return classMethods;
        }

        const namespaced = this.index.findSymbol(`${tag}::${method}`);
        if (namespaced.length) {
            return namespaced;
        }

        return this.index.findSymbol(`${tag}_${method}`);
    }

    findPawnClassDefinitions(context) {
        if (context.kind === "class") {
            if (context.preferConstructor) {
                let constructors = this.index.findClassMember(context.className, context.className)
                    .concat(this.index.findClassMember(context.className, "constructor"));
                if (context.arity !== undefined) {
                    constructors = constructors.filter((record) => record.arity === context.arity);
                }
                if (constructors.length) {
                    return constructors;
                }
            }

            return this.index.findClass(context.className);
        }

        if (context.kind !== "member") {
            return [];
        }

        let members = this.index.findClassMember(context.className, context.memberName);
        if (context.callable) {
            const callable = members.filter((record) => record.kind !== "class-field");
            if (callable.length) {
                members = callable;
            } else if (OOP_HELPER_MEMBERS.has(context.memberName)) {
                return this.index.findClass(context.className);
            }
        } else {
            const fields = members.filter((record) => record.kind === "class-field");
            if (fields.length) {
                members = fields;
            }
        }

        return members;
    }

    findNamespacedAliasDefinitions(word) {
        const alias = getNamespacedAliasName(word);
        if (!alias) {
            return [];
        }

        return this.index.findSymbol(alias);
    }
}

class PawnReferenceProvider {
    constructor(index) {
        this.index = index;
        this.disposable = vscode.languages.registerReferenceProvider(
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

    provideReferences(document, position) {
        if (!getConfig().get("definitions.enabled", true) || !isPawnDocument(document)) {
            return undefined;
        }

        const wordRange = getPawnSymbolRangeAtPosition(document, position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const callbackReferences = this.index.findMysqlCallback(word);
        if (!callbackReferences.length) {
            return undefined;
        }

        return uniqueLocations(callbackReferences)
            .sort(compareSymbolRecords)
            .map((record) => new vscode.Location(record.uri, record.range));
    }
}

class PawnIncludeLinkProvider {
    constructor() {
        this.disposable = vscode.languages.registerDocumentLinkProvider(
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

    async provideDocumentLinks(document) {
        if (!isPawnDocument(document)) {
            return [];
        }

        const links = [];
        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            const includePath = parseIncludePath(document.lineAt(lineNumber).text);
            if (!includePath) {
                continue;
            }

            const target = await resolveIncludeTarget(document.uri, includePath.path);
            if (!target) {
                continue;
            }

            const targetUri = target.isDirectory
                ? vscode.Uri.parse(`command:neoPawnHelper.openIncludePath?${encodeURIComponent(JSON.stringify([target.uri.toString()]))}`)
                : target.uri;
            const link = new vscode.DocumentLink(
                new vscode.Range(
                    new vscode.Position(lineNumber, includePath.start),
                    new vscode.Position(lineNumber, includePath.end)
                ),
                targetUri
            );
            link.tooltip = `Open ${includePath.path}`;
            links.push(link);
        }

        return links;
    }
}

function parseIncludePath(line) {
    const match = line.match(/^\s*#\s*include\s*(<([^>]+)>|"([^"]+)"|([^\s;]+))/i);
    if (!match) {
        return undefined;
    }

    const value = match[2] || match[3] || match[4];
    if (!value) {
        return undefined;
    }

    const rawStart = line.indexOf(match[1], match.index);
    const start = line.indexOf(value, rawStart);
    return {
        path: value.trim(),
        start,
        end: start + value.length
    };
}

async function resolveIncludeTarget(documentUri, includePath) {
    const normalized = includePath.replace(/[\\/]+/g, path.sep);
    const candidatePaths = getIncludeCandidatePaths(documentUri, normalized);

    for (const candidatePath of candidatePaths) {
        const uri = vscode.Uri.file(candidatePath);
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return {
                uri,
                isDirectory: Boolean(stat.type & vscode.FileType.Directory)
            };
        } catch (_) {
            continue;
        }
    }

    return undefined;
}

function getIncludeCandidatePaths(documentUri, includePath) {
    const roots = getWorkspaceRootPaths(documentUri);
    const bases = [path.dirname(documentUri.fsPath)];
    const candidates = [];
    const seen = new Set();

    for (const root of roots) {
        bases.push(root, path.join(root, "pawno", "include"), path.join(root, "include"), path.join(root, "includes"));
    }

    if (path.isAbsolute(includePath)) {
        addIncludeCandidates(candidates, seen, includePath);
    } else {
        for (const base of bases) {
            addIncludeCandidates(candidates, seen, path.resolve(base, includePath));
        }
    }

    return candidates;
}

function getWorkspaceRootPaths(documentUri) {
    const roots = [];
    const seen = new Set();
    const activeFolder = vscode.workspace.getWorkspaceFolder(documentUri);

    if (activeFolder) {
        addUniqueFsPath(roots, seen, activeFolder.uri.fsPath);
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
        addUniqueFsPath(roots, seen, folder.uri.fsPath);
    }

    return roots;
}

function addIncludeCandidates(candidates, seen, candidatePath) {
    addUniqueFsPath(candidates, seen, candidatePath);

    if (path.extname(candidatePath) || /[\\/]$/.test(candidatePath)) {
        return;
    }

    addUniqueFsPath(candidates, seen, `${candidatePath}.inc`);
    addUniqueFsPath(candidates, seen, `${candidatePath}.pwn`);
    addUniqueFsPath(candidates, seen, `${candidatePath}.module`);
}

function addUniqueFsPath(list, seen, fsPath) {
    const normalized = path.normalize(fsPath);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (!seen.has(key)) {
        seen.add(key);
        list.push(normalized);
    }
}

async function openIncludePath(target) {
    const uri = vscode.Uri.parse(target);
    const stat = await vscode.workspace.fs.stat(uri);

    if (stat.type & vscode.FileType.Directory) {
        await vscode.commands.executeCommand("revealInExplorer", uri);
        return;
    }

    await vscode.window.showTextDocument(uri, { preview: false });
}

function scanPawnTextToEntry(uri, text) {
    const entry = {
        symbols: new Map(),
        dialogs: new Map(),
        colors: new Map(),
        numericValues: new Map(),
        mysqlCallbacks: new Map(),
        classes: new Map(),
        classParents: new Map(),
        classMembers: new Map(),
        classVariables: new Map()
    };

    scanPawnText(uri, text, entry.symbols, entry.dialogs, entry.colors, entry.numericValues, entry.mysqlCallbacks);
    scanPawnOopText(uri, text, entry);
    return entry;
}

function mergeRecordMap(target, source) {
    for (const records of source.values()) {
        for (const record of records) {
            addRecord(target, record);
        }
    }
}

function mergeKeyedRecordMap(target, source) {
    for (const [key, records] of source) {
        for (const record of records) {
            addRecordByKey(target, key, record);
        }
    }
}

function mergeColorMap(target, source) {
    for (const [name, color] of source) {
        target.set(name, color);
    }
}

function mergeNumericValueMap(target, source) {
    for (const value of source.values()) {
        for (const declaration of value.declarations) {
            addNumericValueRecord(target, declaration);
        }
    }
}

function decodePawnBytes(bytes) {
    try {
        return PAWN_UTF8_DECODER.decode(bytes);
    } catch {
        return PAWN_FILE_DECODER.decode(bytes);
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

function scanPawnText(uri, text, symbols, dialogs, colors, numericValues, mysqlCallbacks) {
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

            const body = defineMatch[2];
            const color = parseColorFromText(body, true);
            if (color) {
                colors.set(name, color);
            } else if (!PAWN_VALUE_HINT_RESERVED.has(name) && stripped[nameIndex + name.length] !== "(") {
                const numericValue = parseNumericValueFromText(body);
                if (numericValue) {
                    addNumericValue(numericValues, name, "define", numericValue, uri, lineNumber, nameIndex, nameIndex + name.length);
                }
            }
        }

        if (enumState.active) {
            parseEnumContent(stripped, uri, lineNumber, 0, symbols, numericValues);
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
                parseEnumContent(afterOpen, uri, lineNumber, openIndex + 1, symbols, numericValues);
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

            for (const record of parseNumericConstDeclarations(stripped, uri, lineNumber)) {
                addNumericValueRecord(numericValues, record);
            }
        }

        braceDepth = updateBraceDepth(braceDepth, code);
    }

    scanMysqlCallbacks(uri, text, mysqlCallbacks);
}

function scanPawnOopText(uri, text, entry) {
    scanPawnClasses(uri, text, entry);
    scanPawnClassVariables(uri, text, entry);
}

function scanPawnClasses(uri, text, entry) {
    const lines = getLines(text);
    const commentState = { inBlock: false };
    let braceDepth = 0;
    let activeClass = undefined;
    let pendingClass = undefined;

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        const code = maskStrings(stripped);
        const classDeclaration = !activeClass && braceDepth === 0 ? parsePawnClassDeclaration(stripped) : undefined;

        if (classDeclaration) {
            const record = makeRecord(
                classDeclaration.name,
                "class",
                uri,
                item.line,
                classDeclaration.nameStart,
                classDeclaration.nameEnd
            );
            addRecord(entry.classes, record);
            addRecord(entry.symbols, record);
            if (classDeclaration.parentName) {
                entry.classParents.set(classDeclaration.name, {
                    name: classDeclaration.parentName,
                    uri,
                    range: new vscode.Range(
                        new vscode.Position(item.line, classDeclaration.parentStart),
                        new vscode.Position(item.line, classDeclaration.parentEnd)
                    )
                });
            }

            if (code.includes("{")) {
                activeClass = {
                    name: classDeclaration.name,
                    depth: braceDepth + 1,
                    line: item.line
                };
                pendingClass = undefined;
            } else {
                pendingClass = classDeclaration.name;
            }
        } else if (!activeClass && pendingClass && braceDepth === 0 && code.includes("{")) {
            activeClass = {
                name: pendingClass,
                depth: braceDepth + 1,
                line: item.line
            };
            pendingClass = undefined;
        }

        if (activeClass && item.line !== activeClass.line && braceDepth === activeClass.depth) {
            const member = parseClassMemberDeclaration(stripped, code, activeClass.name);
            if (member) {
                addClassMemberRecord(entry, activeClass.name, member, uri, item.line);
            }
        }

        const nextDepth = updateBraceDepth(braceDepth, code);
        if (activeClass && nextDepth < activeClass.depth) {
            activeClass = undefined;
        }
        braceDepth = nextDepth;
    }
}

function scanPawnClassVariables(uri, text, entry) {
    const lines = getLines(text);
    const commentState = { inBlock: false };
    let braceDepth = 0;
    let activeClass = undefined;
    let pendingClass = undefined;

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        const code = maskStrings(stripped);
        const classDeclaration = !activeClass && braceDepth === 0 ? parsePawnClassDeclaration(stripped) : undefined;

        if (classDeclaration) {
            if (code.includes("{")) {
                activeClass = {
                    name: classDeclaration.name,
                    depth: braceDepth + 1,
                    line: item.line
                };
                pendingClass = undefined;
            } else {
                pendingClass = classDeclaration.name;
            }
        } else if (!activeClass && pendingClass && braceDepth === 0 && code.includes("{")) {
            activeClass = {
                name: pendingClass,
                depth: braceDepth + 1,
                line: item.line
            };
            pendingClass = undefined;
        }

        if (!activeClass || braceDepth !== activeClass.depth) {
            for (const record of parseClassVariableDeclarations(stripped, uri, item.line)) {
                addRecord(entry.classVariables, record);
            }
        }

        const nextDepth = updateBraceDepth(braceDepth, code);
        if (activeClass && nextDepth < activeClass.depth) {
            activeClass = undefined;
        }
        braceDepth = nextDepth;
    }
}

function parsePawnClassDeclaration(line) {
    const match = line.match(PAWN_CLASS_DECL_RE);
    if (!match) {
        return undefined;
    }

    const modifier = match[1];
    const name = match[2];
    const parentName = match[4];
    const nameStart = line.indexOf(name, match.index);
    const classKeywordStart = line.indexOf("class", match.index);
    const parentStart = parentName ? line.indexOf(parentName, nameStart + name.length) : -1;
    return {
        name,
        modifier,
        modifierStart: modifier ? line.indexOf(modifier, match.index) : -1,
        modifierEnd: modifier ? line.indexOf(modifier, match.index) + modifier.length : -1,
        keywordStart: classKeywordStart,
        keywordEnd: classKeywordStart + "class".length,
        nameStart,
        nameEnd: nameStart + name.length,
        extendsKeyword: match[3],
        extendsStart: match[3] ? line.indexOf(match[3], nameStart + name.length) : -1,
        extendsEnd: match[3] ? line.indexOf(match[3], nameStart + name.length) + match[3].length : -1,
        parentName,
        parentStart,
        parentEnd: parentName ? parentStart + parentName.length : -1
    };
}

function parseClassMemberDeclaration(line, code, className) {
    return parseClassMethodDeclaration(line, code, className) || parseClassFieldDeclaration(line, code);
}

function parseClassMethodDeclaration(line, code, className) {
    const open = code.indexOf("(");
    if (open === -1) {
        return undefined;
    }

    const beforeOpen = code.slice(0, open);
    if (/[=;\[]/.test(beforeOpen)) {
        return undefined;
    }

    const nameMatch = beforeOpen.match(/(~?)([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (!nameMatch) {
        return undefined;
    }

    const destructor = nameMatch[1] === "~";
    const name = nameMatch[2];
    if (CONTROL_WORDS.has(name)) {
        return undefined;
    }

    const nameStart = beforeOpen.lastIndexOf(name);
    const prefix = beforeOpen.slice(0, destructor ? nameStart - 1 : nameStart).trim();
    if (!prefix && name !== className && name !== "constructor" && !destructor) {
        return undefined;
    }
    if (destructor && name !== className) {
        return undefined;
    }

    const close = code.indexOf(")", open);
    if (close === -1) {
        return undefined;
    }

    const afterClose = code.slice(close + 1).trim();
    if (afterClose && !afterClose.startsWith("{") && !afterClose.startsWith(";")) {
        return undefined;
    }

    const prefixWords = (prefix.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
        .filter((word) => !new RegExp(`^(?:${OOP_MEMBER_MODIFIERS_SOURCE})$`).test(word));
    const returnType = destructor ? undefined : (prefixWords.length ? prefixWords[prefixWords.length - 1] : className);
    const returnTypeStart = prefixWords.length ? beforeOpen.lastIndexOf(returnType, nameStart) : -1;
    const kind = destructor
        ? "class-destructor"
        : (name === className || name === "constructor" ? "class-constructor" : "class-method");
    const argumentsText = code.slice(open + 1, close).trim();
    const arity = argumentsText ? splitTopLevelSegments(argumentsText, 0).length : 0;
    return {
        name: destructor ? `~${name}` : name,
        kind,
        returnType,
        returnTypeStart,
        start: nameStart,
        end: nameStart + name.length,
        arity,
        signature: line.trim()
    };
}

function parseClassFieldDeclaration(line, code) {
    const semicolon = code.indexOf(";");
    if (semicolon === -1 || code.slice(0, semicolon).includes("(")) {
        return undefined;
    }

    const beforeAssign = line.slice(0, semicolon).split("=")[0];
    const modifiers = beforeAssign.match(new RegExp(`^\\s*(?:(?:${OOP_MEMBER_MODIFIERS_SOURCE}|const)\\s+)*`))[0];
    const declaration = beforeAssign.slice(modifiers.length);
    let match = declaration.match(/^(?:new\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/);
    let typeName;
    let typeStart = -1;
    let name;
    let start;

    if (match) {
        typeName = match[1];
        name = match[2];
        typeStart = modifiers.length + declaration.indexOf(typeName, match.index);
        start = modifiers.length + declaration.indexOf(name, declaration.indexOf(":", match.index) + 1);
    } else {
        match = declaration.match(/^(?:new\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+(?:[&*]\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (match) {
            typeName = match[1];
            name = match[2];
            typeStart = modifiers.length + declaration.indexOf(typeName, match.index);
            start = modifiers.length + declaration.indexOf(name, declaration.indexOf(typeName, match.index) + typeName.length);
        } else {
            match = declaration.match(/^(?:new\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
            if (!match) {
                return undefined;
            }

            typeName = undefined;
            name = match[1];
            start = modifiers.length + declaration.indexOf(name, match.index);
        }
    }

    if (CONTROL_WORDS.has(name)) {
        return undefined;
    }

    return {
        name,
        kind: "class-field",
        typeName,
        typeStart,
        start,
        end: start + name.length,
        signature: line.trim()
    };
}

function parseClassVariableDeclarations(line, uri, lineNumber, acceptsClassName, allowUppercaseFallback = true) {
    return parseClassVariableDeclarationItems(line, acceptsClassName, allowUppercaseFallback).map((item) => ({
        ...makeRecord(item.name, "class-var", uri, lineNumber, item.nameStart, item.nameEnd),
        className: item.className
    }));
}

function parseClassVariableDeclarationItems(line, acceptsClassName, allowUppercaseFallback = true) {
    const semicolon = maskStrings(line).indexOf(";");
    if (semicolon === -1) {
        return [];
    }

    const statement = line.slice(0, semicolon);
    if (/^\s*(?:#|class\b|enum\b|return\b|if\b|for\b|while\b|switch\b)/.test(statement)) {
        return [];
    }

    let match = statement.match(new RegExp(`^\\s*(?:new|static|owned)\\s+(${PAWN_IDENTIFIER_SOURCE})\\s*:\\s*(.*)$`));
    if (match) {
        const className = match[1];
        if (!isPawnClassNameCandidate(className, acceptsClassName, allowUppercaseFallback)) {
            return [];
        }

        const rest = match[2];
        const restOffset = statement.indexOf(rest, match.index);
        const classStart = statement.indexOf(className, match.index);
        return parseClassVariableItemsFromRest(className, rest, restOffset, classStart);
    }

    match = statement.match(new RegExp(`^\\s*(?:(?:new|static|owned|const)\\s+)*(${PAWN_IDENTIFIER_SOURCE})\\s+(.*)$`));
    if (!match) {
        return [];
    }

    const className = match[1];
    if (!isPawnClassNameCandidate(className, acceptsClassName, allowUppercaseFallback)) {
        return [];
    }

    const rest = match[2];
    const restOffset = statement.indexOf(rest, match.index);
    const classStart = statement.indexOf(className, match.index);
    return parseClassVariableItemsFromRest(className, rest, restOffset, classStart);
}

function parseClassVariableItemsFromRest(className, rest, restOffset, classStart) {
    const items = [];
    for (const segment of splitTopLevelSegments(rest, restOffset)) {
        const beforeAssign = segment.text.split("=")[0];
        const match = beforeAssign.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/);
        if (!match) {
            continue;
        }

        const name = match[1];
        if (CONTROL_WORDS.has(name)) {
            continue;
        }

        const nameStart = segment.offset + beforeAssign.indexOf(name, match.index);
        items.push({
            className,
            classStart,
            classEnd: classStart + className.length,
            name,
            nameStart,
            nameEnd: nameStart + name.length
        });
    }

    return items;
}

function parseClassParameterDeclarations(line, uri, lineNumber, acceptsClassName) {
    const code = maskStrings(line);
    const open = code.indexOf("(");
    const close = code.lastIndexOf(")");
    if (open === -1 || close <= open) {
        return [];
    }

    const records = [];
    const parameters = line.slice(open + 1, close);
    for (const segment of splitTopLevelSegments(parameters, open + 1)) {
        const text = segment.text.trim();
        let match = text.match(new RegExp(`^(?:(?:const|owned)\\s+)*(${PAWN_IDENTIFIER_SOURCE})\\s*:\\s*(&?${PAWN_IDENTIFIER_SOURCE})`));
        let className;
        let name;
        if (match) {
            className = match[1];
            name = match[2].replace(/^&/, "");
        } else {
            match = text.match(new RegExp(`^(?:(?:const|owned)\\s+)*(${PAWN_IDENTIFIER_SOURCE})\\s+(?:[&*]\\s*)?(${PAWN_IDENTIFIER_SOURCE})`));
            if (!match) {
                continue;
            }
            className = match[1];
            name = match[2];
        }

        if (!isPawnClassNameCandidate(className, acceptsClassName, false)) {
            continue;
        }

        const nameStart = segment.offset + segment.text.indexOf(name);
        records.push({
            ...makeRecord(name, "class-var", uri, lineNumber, nameStart, nameStart + name.length),
            className,
            classStart: segment.offset + segment.text.indexOf(className),
            classEnd: segment.offset + segment.text.indexOf(className) + className.length
        });
    }
    return records;
}

function isPawnClassNameCandidate(name, acceptsClassName, allowUppercaseFallback) {
    if (!name || isIgnoredPawnType(name)) {
        return false;
    }

    if (acceptsClassName && acceptsClassName(name)) {
        return true;
    }

    return allowUppercaseFallback && /^[A-Z]/.test(name);
}

function isIgnoredPawnType(name) {
    return PAWN_BUILTIN_TYPES.has(name) ||
        PAWN_BUILTIN_TYPES.has(name.toLowerCase()) ||
        /^(class|enum|forward|foreign|global|hook|native|new|public|return|task|timer|ptask)$/i.test(name);
}

function addClassMemberRecord(entry, className, member, uri, lineNumber) {
    const record = {
        ...makeRecord(member.name, member.kind, uri, lineNumber, member.start, member.end),
        className,
        returnType: member.returnType,
        arity: member.arity,
        signature: member.signature
    };
    addRecordByKey(entry.classMembers, makeClassMemberKey(className, member.name), record);

    if (member.kind === "class-constructor") {
        addRecordByKey(entry.classMembers, makeClassMemberKey(className, "constructor"), record);
        for (const name of [`${className}_Ctor`, `${className}_Ctor${member.arity}`, `${className}_New`, `${className}_New${member.arity}`]) {
            addRecord(entry.symbols, { ...record, name });
        }
        return;
    }

    if (member.kind === "class-destructor") {
        addRecord(entry.symbols, { ...record, name: `${className}_Dtor` });
        return;
    }

    const generatedName = makeOopGeneratedMemberName(className, member.name);
    addRecord(entry.symbols, { ...record, name: generatedName });

    if ((member.returnType || "").toLowerCase() === "dialog") {
        const dialogRecord = { ...record, name: generatedName, kind: "dialog" };
        addRecord(entry.dialogs, dialogRecord);
        addRecord(entry.symbols, dialogRecord);
    }
}

function makeClassMemberKey(className, memberName) {
    return `${className}.${memberName}`;
}

function makeOopGeneratedMemberName(className, memberName) {
    return `${className}_${toPawnGeneratedMemberSuffix(memberName)}`;
}

function toPawnGeneratedMemberSuffix(name) {
    return name
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

function collectColorDecorations(document, index) {
    const text = document.getText();
    const decorations = new Map();
    const highlightNamedColors = getConfig().get("colors.variables.enabled", true);

    addRegexColorDecorations(document, text, /\b0x([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?\b/g, 1, decorations);
    addRegexColorDecorations(document, text, /\{([0-9A-Fa-f]{6})\}/g, 1, decorations);
    addDefineBareColorDecorations(document, text, decorations);

    if (!highlightNamedColors) {
        return decorations;
    }

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

function collectNumericValueHints(document, range, index) {
    const text = document.getText();
    const lines = getLines(text);
    const commentState = { inBlock: false };
    const hints = [];
    const visibleRange = range || new vscode.Range(new vscode.Position(0, 0), document.positionAt(text.length));

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        if (item.line > visibleRange.end.line) {
            break;
        }

        if (item.line < visibleRange.start.line) {
            continue;
        }

        const code = maskStrings(stripped);
        const identifierRe = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
        let match;
        while ((match = identifierRe.exec(code)) !== null) {
            const name = match[0];
            if (PAWN_VALUE_HINT_RESERVED.has(name) || index.getColor(name)) {
                continue;
            }

            const numericValue = index.getNumericValue(name);
            if (!numericValue) {
                continue;
            }

            const start = new vscode.Position(item.line, match.index);
            const end = new vscode.Position(item.line, match.index + name.length);
            if (isNumericValueDeclaration(numericValue, document.uri, start, end)) {
                continue;
            }

            const hint = new vscode.InlayHint(end, numericValue.value, vscode.InlayHintKind.Type);
            hint.paddingLeft = true;
            hint.paddingRight = true;
            hint.tooltip = `${name} = ${numericValue.value}`;
            hints.push(hint);
        }
    }

    return hints;
}

function buildPawnSemanticTokens(document, index) {
    const builder = new vscode.SemanticTokensBuilder(PAWN_SEMANTIC_LEGEND);
    const lines = getLines(document.getText());
    const commentState = { inBlock: false };
    let braceDepth = 0;
    let activeClass = undefined;
    let pendingClass = undefined;

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        const code = maskStrings(stripped);
        const tokens = [];
        const classDeclaration = !activeClass && braceDepth === 0 ? parsePawnClassDeclaration(stripped) : undefined;

        if (classDeclaration) {
            if (classDeclaration.modifier) {
                addSemanticToken(tokens, classDeclaration.modifierStart, classDeclaration.modifierEnd - classDeclaration.modifierStart, "keyword");
            }
            addSemanticToken(tokens, classDeclaration.keywordStart, classDeclaration.keywordEnd - classDeclaration.keywordStart, "keyword");
            addSemanticToken(tokens, classDeclaration.nameStart, classDeclaration.nameEnd - classDeclaration.nameStart, "class");
            if (classDeclaration.extendsKeyword) {
                addSemanticToken(tokens, classDeclaration.extendsStart, classDeclaration.extendsEnd - classDeclaration.extendsStart, "keyword");
                addSemanticToken(tokens, classDeclaration.parentStart, classDeclaration.parentEnd - classDeclaration.parentStart, "class");
            }

            if (code.includes("{")) {
                activeClass = {
                    name: classDeclaration.name,
                    depth: braceDepth + 1,
                    line: item.line
                };
                pendingClass = undefined;
            } else {
                pendingClass = classDeclaration.name;
            }
        } else if (!activeClass && pendingClass && braceDepth === 0 && code.includes("{")) {
            activeClass = {
                name: pendingClass,
                depth: braceDepth + 1,
                line: item.line
            };
            pendingClass = undefined;
        }

        if (activeClass && item.line !== activeClass.line && braceDepth === activeClass.depth) {
            addClassMemberDeclarationTokens(tokens, stripped, code, activeClass.name);
            addFunctionParameterTokens(tokens, stripped, index);
        } else {
            addClassVariableDeclarationTokens(tokens, stripped, index);
            addFunctionDeclarationTokens(tokens, stripped, code, index);
            addVariableDeclarationTokens(tokens, stripped, index);
        }

        addNewClassTokens(tokens, code, index);
        addMemberAccessTokens(tokens, code);
        addOopKeywordTokens(tokens, code);
        addBuiltinTypeTokens(tokens, code);
        addKnownClassTokens(tokens, code, index);
        addPawnNamespaceTokens(tokens, code);
        pushSemanticTokens(builder, tokens, item.line);

        const nextDepth = updateBraceDepth(braceDepth, code);
        if (activeClass && nextDepth < activeClass.depth) {
            activeClass = undefined;
        }
        braceDepth = nextDepth;
    }

    return builder.build();
}

function addPawnNamespaceTokens(tokens, line) {
    PAWN_NAMESPACE_RE.lastIndex = 0;

    let match;
    while ((match = PAWN_NAMESPACE_RE.exec(line)) !== null) {
        const namespace = match[1];
        const name = match[2];
        const nameStart = match.index + namespace.length + 2;

        addSemanticToken(tokens, match.index, namespace.length + 2, "namespace");
        addSemanticToken(tokens, nameStart, name.length, "function");
    }
}

function addClassMemberDeclarationTokens(tokens, line, code, className) {
    const member = parseClassMemberDeclaration(line, code, className);
    if (!member) {
        return;
    }

    if (member.typeName) {
        addSemanticToken(tokens, member.typeStart, member.typeName.length, "type");
    } else if (member.returnType && member.returnType !== className) {
        addSemanticToken(tokens, member.returnTypeStart, member.returnType.length, "type");
    }

    const prefix = line.slice(0, member.start);
    const modifierRe = new RegExp(`\\b(${OOP_MEMBER_MODIFIERS_SOURCE})\\b`, "g");
    let modifierMatch;
    while ((modifierMatch = modifierRe.exec(prefix)) !== null) {
        addSemanticToken(tokens, modifierMatch.index, modifierMatch[1].length, "keyword");
    }
    addSemanticToken(tokens, member.start, member.end - member.start, member.kind === "class-field" ? "property" : "method");
}

function addClassVariableDeclarationTokens(tokens, line, index) {
    for (const item of parseClassVariableDeclarationItems(line, (name) => isKnownPawnClass(index, name), false)) {
        addSemanticToken(tokens, item.classStart, item.classEnd - item.classStart, "class");
        addSemanticToken(tokens, item.nameStart, item.nameEnd - item.nameStart, "variable");
    }
}

function addNewClassTokens(tokens, line, index) {
    PAWN_NEW_CLASS_RE.lastIndex = 0;

    let match;
    while ((match = PAWN_NEW_CLASS_RE.exec(line)) !== null) {
        const className = match[1];
        if (!isKnownPawnClass(index, className) && !/^[A-Z]/.test(className)) {
            continue;
        }

        const newStart = match.index + match[0].indexOf("new");
        const classStart = match.index + match[0].indexOf(className);
        addSemanticToken(tokens, newStart, 3, "keyword");
        addSemanticToken(tokens, classStart, className.length, "class");
    }
}

function addMemberAccessTokens(tokens, line) {
    const memberAccessRe = new RegExp(`\\b(${PAWN_IDENTIFIER_SOURCE})(?:\\s*\\[[^\\]]*\\])*\\s*\\.\\s*(${PAWN_IDENTIFIER_SOURCE})\\b`, "g");
    let match;

    while ((match = memberAccessRe.exec(line)) !== null) {
        const owner = match[1];
        const member = match[2];
        const memberStart = match.index + match[0].lastIndexOf(member);
        const afterMember = line.slice(memberStart + member.length);
        const tokenType = /^\s*\(/.test(afterMember) ? "method" : "property";

        if (owner === "this") {
            addSemanticToken(tokens, match.index, owner.length, "variable");
        }

        addSemanticToken(tokens, memberStart, member.length, tokenType);
    }
}

function addFunctionDeclarationTokens(tokens, line, code, index) {
    const header = parseFunctionHeader(line);
    if (!isFunctionDefinitionLine(code, header)) {
        return;
    }

    for (const modifier of header.modifiers) {
        const start = line.indexOf(modifier);
        addSemanticToken(tokens, start, modifier.length, "keyword");
    }
    addTypeToken(tokens, header.returnType, header.returnTypeStart, index);

    if (!header.name.includes("::")) {
        addSemanticToken(tokens, header.nameStart, header.name.length, "function");
    }
    addFunctionParameterTokens(tokens, line, index, header.openParen);
}

function addFunctionParameterTokens(tokens, line, index, openParen) {
    const code = maskStrings(line);
    const open = openParen === undefined ? code.indexOf("(") : openParen;
    const close = code.lastIndexOf(")");
    if (open === -1 || close <= open) {
        return;
    }

    for (const segment of splitTopLevelSegments(line.slice(open + 1, close), open + 1)) {
        const item = parseVariableDeclarationSegment(segment, true);
        if (!item || item.name === "va_args") {
            continue;
        }
        addTypeToken(tokens, item.typeName, item.typeStart, index);
        addSemanticToken(tokens, item.nameStart, item.name.length, "parameter");
    }
}

function addVariableDeclarationTokens(tokens, line, index) {
    for (const item of parseVariableDeclarationItems(line)) {
        addTypeToken(tokens, item.typeName, item.typeStart, index);
        addSemanticToken(tokens, item.nameStart, item.name.length, "variable");
    }
}

function addBuiltinTypeTokens(tokens, line) {
    const typeRe = new RegExp(`\\b(${Array.from(PAWN_BUILTIN_TYPES).join("|")})\\b`, "g");
    let match;
    while ((match = typeRe.exec(line)) !== null) {
        addSemanticToken(tokens, match.index, match[1].length, "type");
    }
}

function addTypeToken(tokens, typeName, start, index) {
    if (!typeName || start < 0 || typeName === "_") {
        return;
    }
    addSemanticToken(tokens, start, typeName.length, isKnownPawnClass(index, typeName) ? "class" : "type");
}

function addOopKeywordTokens(tokens, line) {
    const keywordRe = new RegExp(`\\b(${OOP_MEMBER_MODIFIERS_SOURCE}|class|extends|owned|new|base)\\b`, "g");
    let match;
    while ((match = keywordRe.exec(line)) !== null) {
        addSemanticToken(tokens, match.index, match[1].length, "keyword");
    }
}

function addKnownClassTokens(tokens, line, index) {
    const identifierRe = new RegExp(`\\b${PAWN_IDENTIFIER_SOURCE}\\b`, "g");
    let match;
    while ((match = identifierRe.exec(line)) !== null) {
        if (isKnownPawnClass(index, match[0])) {
            addSemanticToken(tokens, match.index, match[0].length, "class");
        }
    }
}

function addSemanticToken(tokens, start, length, type) {
    const tokenType = PAWN_SEMANTIC_TYPE_INDEX.get(type);
    if (start < 0 || length <= 0 || tokenType === undefined) {
        return;
    }

    tokens.push({ start, length, tokenType });
}

function pushSemanticTokens(builder, tokens, lineNumber) {
    let lastEnd = -1;
    tokens.sort((a, b) => a.start - b.start || b.length - a.length);

    for (const token of tokens) {
        const end = token.start + token.length;
        if (token.start < lastEnd) {
            continue;
        }

        builder.push(lineNumber, token.start, token.length, token.tokenType, 0);
        lastEnd = end;
    }
}

function isNumericValueDeclaration(numericValue, uri, start, end) {
    const uriString = uri.toString();
    return numericValue.declarations.some((record) =>
        record.uri.toString() === uriString &&
        record.range.start.line === start.line &&
        record.range.start.character === start.character &&
        record.range.end.line === end.line &&
        record.range.end.character === end.character
    );
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

function collectSqlDecorations(document) {
    const text = document.getText();
    const keywords = [];
    const placeholders = [];

    for (const literal of collectSqlStringLiterals(text)) {
        SQL_KEYWORD_RE.lastIndex = 0;
        let match;
        while ((match = SQL_KEYWORD_RE.exec(literal.raw)) !== null) {
            keywords.push(new vscode.Range(
                document.positionAt(literal.contentStart + match.index),
                document.positionAt(literal.contentStart + match.index + match[0].length)
            ));
        }

        for (const placeholder of findMysqlFormatPlaceholders(literal.raw)) {
            placeholders.push(new vscode.Range(
                document.positionAt(literal.contentStart + placeholder.index),
                document.positionAt(literal.contentStart + placeholder.index + placeholder.length)
            ));
        }
    }

    return { keywords, placeholders };
}

function collectSqlStringLiterals(text) {
    const byOffset = new Map();

    for (const literal of extractStringLiterals(text, 0)) {
        if (isSqlLikeString(literal.value)) {
            byOffset.set(literal.contentStart, literal);
        }
    }

    for (const call of parsePawnCalls(text, SQL_QUERY_FUNCTIONS)) {
        for (const queryArgIndex of getSqlQueryArgumentIndices(call.name)) {
            if (!call.args[queryArgIndex]) {
                continue;
            }

            for (const literal of extractStringLiterals(call.args[queryArgIndex].text, call.args[queryArgIndex].offset)) {
                if (isSqlLikeString(literal.value)) {
                    byOffset.set(literal.contentStart, literal);
                }
            }
        }
    }

    return Array.from(byOffset.values()).sort((a, b) => a.contentStart - b.contentStart);
}

function collectMysqlDiagnostics(document) {
    const diagnostics = [];
    const text = document.getText();

    for (const call of parsePawnCalls(text, new Set(["mysql_format"]))) {
        if (call.args.length < 4) {
            continue;
        }

        const formatString = getJoinedStringLiterals(call.args[3]);
        if (!formatString) {
            continue;
        }

        const placeholders = countMysqlFormatPlaceholders(formatString.value);
        const providedArgs = Math.max(0, call.args.length - 4);
        if (placeholders === providedArgs) {
            continue;
        }

        const range = new vscode.Range(
            document.positionAt(formatString.contentStart),
            document.positionAt(formatString.contentEnd)
        );
        const diagnostic = new vscode.Diagnostic(
            range,
            `mysql_format expects ${placeholders} value argument(s) for ${MYSQL_FORMAT_SPECIFIER_LABEL}, but ${providedArgs} provided.`,
            vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = "NeoPawn Helper";
        diagnostics.push(diagnostic);
    }

    return diagnostics;
}

function maybeTriggerSqlSnippetSuggest(event) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
        return;
    }

    for (const change of event.contentChanges) {
        if (!/\s$/.test(change.text)) {
            continue;
        }

        const position = event.document.positionAt(change.rangeOffset + change.text.length);
        if (getSqlSnippetContext(event.document, position)) {
            setTimeout(() => {
                vscode.commands.executeCommand("editor.action.triggerSuggest");
            }, 0);
            return;
        }
    }
}

function getSqlSnippetContext(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const literal = findStringLiteralAtOffset(text, offset);
    if (!literal) {
        return undefined;
    }

    const callFrame = findSqlCallFrameAtOffset(text, literal.start);
    if (!callFrame) {
        return undefined;
    }

    const trigger = getSqlSnippetTrigger(text, literal.contentStart, offset);
    if (!trigger) {
        return undefined;
    }

    const range = new vscode.Range(
        document.positionAt(trigger.start),
        document.positionAt(offset)
    );
    const deleteRange = getSqlSnippetClosingQuoteDeleteRange(document, literal, offset);

    return {
        quote: literal.quote,
        range,
        deleteRange,
        typedKeyword: trigger.typedKeyword,
        definitions: trigger.definitions
    };
}

function findSqlCallFrameAtOffset(text, offset) {
    const stack = getCallStackAtOffset(text, offset);

    for (let index = stack.length - 1; index >= 0; index--) {
        const frame = stack[index];
        if (!frame.name) {
            continue;
        }

        const argIndices = getSqlQueryArgumentIndices(frame.name);
        if (argIndices.includes(frame.argIndex)) {
            return frame;
        }
    }

    return undefined;
}

function getSqlSnippetTrigger(text, contentStart, offset) {
    const prefix = text.slice(contentStart, offset);
    const match = prefix.match(/(?:^|[^A-Za-z0-9_])([A-Za-z]+)\s*$/);
    if (!match) {
        return undefined;
    }

    const typedKeyword = match[1].toUpperCase();
    const definitions = SQL_SNIPPET_DEFINITIONS.filter((definition) => definition.keyword.startsWith(typedKeyword));
    if (!definitions.length) {
        return undefined;
    }

    const keywordStartInMatch = match[0].lastIndexOf(match[1]);
    const start = contentStart + match.index + keywordStartInMatch;
    return { start, typedKeyword, definitions };
}

function getSqlSnippetClosingQuoteDeleteRange(document, literal, offset) {
    if (!literal.closed) {
        return undefined;
    }

    const cursor = document.positionAt(offset);
    const quoteStart = document.positionAt(literal.contentEnd);
    const quoteEnd = document.positionAt(literal.end);
    return cursor.line === quoteStart.line ? new vscode.Range(quoteStart, quoteEnd) : undefined;
}

function scanMysqlCallbacks(uri, text, mysqlCallbacks) {
    for (const call of parsePawnCalls(text, MYSQL_QUERY_FUNCTIONS)) {
        const callbackArgIndex = MYSQL_CALLBACK_ARGUMENT.get(call.name.toLowerCase());
        if (callbackArgIndex === undefined || !call.args[callbackArgIndex]) {
            continue;
        }

        const callbackLiteral = getFirstStringLiteral(call.args[callbackArgIndex]);
        if (!callbackLiteral) {
            continue;
        }

        const callback = callbackLiteral.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(callback)) {
            continue;
        }

        addRecord(mysqlCallbacks, makeRecordFromOffsets(
            callback,
            "mysql-callback",
            uri,
            text,
            callbackLiteral.contentStart,
            callbackLiteral.contentEnd
        ));
    }
}

function getSqlQueryArgumentIndices(name) {
    const lowered = name.toLowerCase();
    if (lowered === "format") {
        return [2];
    }

    if (lowered === "mysql_format") {
        return [3, 2];
    }

    const mysqlQueryArgIndex = getMysqlQueryArgumentIndex(name);
    return mysqlQueryArgIndex === undefined ? [] : [mysqlQueryArgIndex];
}

function getMysqlQueryArgumentIndex(name) {
    const lowered = name.toLowerCase();
    if (lowered === "mysql_format") {
        return 3;
    }

    if (
        lowered === "mysql_query" ||
        lowered === "mysql_tquery" ||
        lowered === "mysql_pquery" ||
        lowered === "mysql_function_query"
    ) {
        return 1;
    }

    return undefined;
}

function isSqlLikeString(value) {
    return SQL_START_RE.test(value) && SQL_CONTEXT_RE.test(value);
}

function countMysqlFormatPlaceholders(value) {
    return findMysqlFormatPlaceholders(value).length;
}

function findMysqlFormatPlaceholders(value) {
    const placeholders = [];

    for (let index = 0; index < value.length; index++) {
        if (value[index] !== "%") {
            continue;
        }

        if (value[index + 1] === "%") {
            index++;
            continue;
        }

        let specifierIndex = index + 1;
        while (specifierIndex < value.length && /[-+0-9.]/.test(value[specifierIndex])) {
            specifierIndex++;
        }

        const specifier = (value[specifierIndex] || "").toLowerCase();
        if (MYSQL_FORMAT_SPECIFIERS.has(specifier)) {
            placeholders.push({
                index,
                length: specifierIndex - index + 1,
                specifier
            });
        }

        index = specifierIndex;
    }

    return placeholders;
}

function parseFunctionDefinition(stripped, code, uri, lineNumber) {
    const header = parseFunctionHeader(stripped);
    if (!isFunctionDefinitionLine(code, header)) {
        return undefined;
    }

    return makeRecord(header.name, "function", uri, lineNumber, header.nameStart, header.nameEnd);
}

function isFunctionDefinitionLine(code, header) {
    if (!header || CONTROL_WORDS.has(header.name)) {
        return false;
    }

    const close = code.lastIndexOf(")");
    if (close === -1) {
        return false;
    }

    const suffix = code.slice(close + 1).trim();
    return suffix.startsWith("{") || suffix === "" ||
        (header.modifiers.length > 0 && (suffix.startsWith(";") || suffix.startsWith("=")));
}

function parseGlobalForeignFunction(stripped, uri, lineNumber) {
    const header = parseFunctionHeader(stripped);
    const keyword = header?.modifiers.find((modifier) => modifier === "global" || modifier === "foreign");
    if (!header || !keyword) {
        return undefined;
    }

    if (CONTROL_WORDS.has(header.name)) {
        return undefined;
    }

    return makeRecord(
        header.name,
        keyword === "global" ? "global-function" : "foreign",
        uri,
        lineNumber,
        header.nameStart,
        header.nameEnd
    );
}

function parseFunctionHeader(line) {
    const match = line.match(FUNCTION_HEADER_RE);
    if (!match) {
        return undefined;
    }

    const modifiersText = match[1] || "";
    const typeText = (match[2] || "").trim();
    const name = match[3];
    const nameStart = match.index + match[0].lastIndexOf(name);
    let returnType;
    let returnTypeStart = -1;

    if (typeText) {
        returnType = typeText.endsWith(":") ? typeText.slice(0, -1).trim() : typeText;
        returnTypeStart = line.indexOf(returnType, match.index + modifiersText.length);
    }

    const modifiers = [];
    const modifierRe = new RegExp(`\\b(${ALL_FUNCTION_KEYWORDS_SOURCE})\\b`, "g");
    let modifierMatch;
    while ((modifierMatch = modifierRe.exec(modifiersText)) !== null) {
        modifiers.push(modifierMatch[1]);
    }

    return {
        name,
        nameStart,
        nameEnd: nameStart + name.length,
        returnType,
        returnTypeStart,
        modifiers,
        openParen: match.index + match[0].lastIndexOf("(")
    };
}

function parseGlobalDeclarations(stripped, uri, lineNumber) {
    return parseVariableDeclarationItems(stripped).map((item) =>
        makeRecord(item.name, "global", uri, lineNumber, item.nameStart, item.nameEnd)
    );
}

function parseNumericConstDeclarations(stripped, uri, lineNumber) {
    const declarations = [];
    if (!/^\s*(?:(?:new|static|stock)\s+)*const\b/.test(stripped)) {
        return declarations;
    }

    for (const item of parseVariableDeclarationItems(stripped)) {
        const segment = item.segment;
        const assignIndex = segment.text.indexOf("=");
        if (assignIndex === -1) {
            continue;
        }

        const numericValue = parseNumericValueFromText(segment.text.slice(assignIndex + 1));
        if (!numericValue) {
            continue;
        }

        declarations.push(makeNumericValueRecord(
            item.name,
            "constant",
            numericValue,
            uri,
            lineNumber,
            item.nameStart,
            item.nameEnd
        ));
    }

    return declarations;
}

function parseVariableDeclarationItems(line) {
    const code = maskStrings(line);
    const semicolon = code.indexOf(";");
    if (semicolon === -1 || code.slice(0, semicolon).includes("(")) {
        return [];
    }

    const statement = line.slice(0, semicolon);
    if (/^\s*(?:#|class\b|enum\b|return\b|if\b|for\b|while\b|switch\b|case\b)/.test(statement)) {
        return [];
    }

    const segments = splitTopLevelSegments(statement, 0);
    if (!segments.length) {
        return [];
    }

    const first = parseVariableDeclarationSegment(segments[0], true);
    if (!first || (!first.hasStorage && !first.typeName)) {
        return [];
    }

    const items = [first];
    for (const segment of segments.slice(1)) {
        const item = parseVariableDeclarationSegment(segment, false);
        if (item) {
            items.push(item);
        }
    }
    return items;
}

function parseVariableDeclarationSegment(segment, allowType) {
    const beforeAssign = segment.text.split("=")[0];
    const modifierMatch = beforeAssign.match(/^\s*(?:(?:new|static|stock|const|owned)\s+)*/);
    const modifiers = modifierMatch ? modifierMatch[0] : "";
    const hasStorage = /\b(?:new|static|stock|const|owned)\b/.test(modifiers);
    const body = beforeAssign.slice(modifiers.length);
    const bodyOffset = segment.offset + modifiers.length;
    let match;
    let typeName;
    let typeStart = -1;
    let name;
    let relativeNameStart;

    if (allowType) {
        match = body.match(/^\s*([A-Za-z_][A-Za-z0-9_]*|_)\s*:\s*(?:[&*]\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (match) {
            typeName = match[1];
            name = match[2];
            typeStart = bodyOffset + body.indexOf(typeName, match.index);
            relativeNameStart = body.indexOf(name, body.indexOf(":", match.index) + 1);
        } else {
            match = body.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(?:[&*]\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
            if (match) {
                typeName = match[1];
                name = match[2];
                typeStart = bodyOffset + body.indexOf(typeName, match.index);
                relativeNameStart = body.indexOf(name, body.indexOf(typeName, match.index) + typeName.length);
            }
        }
    }

    if (!name) {
        match = body.match(/^\s*(?:[&*]\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (!match) {
            return undefined;
        }
        name = match[1];
        relativeNameStart = body.indexOf(name, match.index);
    }

    if (CONTROL_WORDS.has(name) || PAWN_VALUE_HINT_RESERVED.has(name)) {
        return undefined;
    }

    const nameStart = bodyOffset + relativeNameStart;
    return {
        name,
        nameStart,
        nameEnd: nameStart + name.length,
        typeName,
        typeStart,
        hasStorage,
        segment
    };
}

function parseEnumContent(content, uri, lineNumber, contentStartCharacter, symbols, numericValues) {
    const cleanContent = content.replace(/[{};]/g, " ");
    const segments = splitTopLevelSegments(cleanContent, contentStartCharacter);

    for (const segment of segments) {
        const assignIndex = segment.text.indexOf("=");
        const beforeAssign = assignIndex === -1 ? segment.text : segment.text.slice(0, assignIndex);
        const match = beforeAssign.match(/^\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*|_)\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)/);
        if (!match) {
            continue;
        }

        const name = match[1];
        if (PAWN_VALUE_HINT_RESERVED.has(name) || name === "enum") {
            continue;
        }

        const relativeNameIndex = beforeAssign.indexOf(name, match.index);
        const nameIndex = segment.offset + relativeNameIndex;
        addSymbol(symbols, name, "enum-member", uri, lineNumber, nameIndex, nameIndex + name.length);

        if (numericValues && assignIndex !== -1) {
            const numericValue = parseNumericValueFromText(segment.text.slice(assignIndex + 1));
            if (numericValue) {
                addNumericValue(numericValues, name, "enum-member", numericValue, uri, lineNumber, nameIndex, nameIndex + name.length);
            }
        }
    }
}

function findLocalDefinitions(document, word, position, index) {
    const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const lines = getLines(text);
    const records = [];
    const uri = document.uri;
    const commentState = { inBlock: false };

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        const declarationRecords = parseGlobalDeclarations(stripped, uri, item.line)
            .filter((record) => record.name === word)
            .map((record) => ({ ...record, kind: "local" }));
        records.push(...declarationRecords);

        const classVariableRecords = parseClassVariableDeclarations(
            stripped,
            uri,
            item.line,
            (name) => isKnownPawnClass(index, name),
            false
        ).filter((record) => record.name === word);
        records.push(...classVariableRecords);

        const functionRecord = parseFunctionDefinition(stripped, maskStrings(stripped), uri, item.line);
        if (functionRecord) {
            for (const record of parseFunctionParameters(stripped, functionRecord, uri, item.line)) {
                if (record.name === word) {
                    records.push(record);
                }
            }
        }

        const activeClass = getEnclosingPawnClass(document, item.line);
        if (activeClass && activeClass.braceDepth === activeClass.depth) {
            const classMember = parseClassMemberDeclaration(stripped, maskStrings(stripped), activeClass.name);
            if (classMember && classMember.kind !== "class-field") {
                const functionRecord = makeRecord(classMember.name, classMember.kind, uri, item.line, classMember.start, classMember.end);
                for (const record of parseFunctionParameters(stripped, functionRecord, uri, item.line)) {
                    if (record.name === word) {
                        records.push(record);
                    }
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
        const item = parseVariableDeclarationSegment(segment, true);
        if (!item || item.name === "va_args") {
            continue;
        }

        records.push(makeRecord(item.name, "local", uri, lineNumber, item.nameStart, item.nameEnd));
    }

    return records;
}

function getPawnSymbolRangeAtPosition(document, position) {
    const line = document.lineAt(position.line).text;
    PAWN_SYMBOL_RE.lastIndex = 0;

    let match;
    while ((match = PAWN_SYMBOL_RE.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
            return new vscode.Range(
                new vscode.Position(position.line, start),
                new vscode.Position(position.line, end)
            );
        }
    }

    return undefined;
}

function getPawnClassReferenceContext(document, wordRange, word, index) {
    if (word === "base") {
        const activeClass = getEnclosingPawnClass(document, wordRange.start.line);
        const parent = activeClass ? index.findClassParent(activeClass.name) : undefined;
        if (parent) {
            return {
                kind: "class",
                className: parent.name,
                preferConstructor: true,
                arity: getCallArity(document.lineAt(wordRange.start.line).text.slice(wordRange.end.character)),
                originRange: wordRange
            };
        }
    }

    const memberContext = getPawnClassMemberReferenceContext(document, wordRange, word, index);
    if (memberContext) {
        return memberContext;
    }

    const declarationContext = getPawnClassMemberDeclarationReferenceContext(document, wordRange);
    if (declarationContext) {
        return declarationContext;
    }

    const classContext = getPawnClassNameReferenceContext(document, wordRange, word, index);
    if (classContext) {
        return classContext;
    }

    return undefined;
}

function getPawnClassMemberReferenceContext(document, wordRange, word, index) {
    const line = document.lineAt(wordRange.start.line).text;
    const afterWord = line.slice(wordRange.end.character);

    if (word === "this") {
        const memberMatch = afterWord.match(new RegExp(`^\\s*\\.\\s*(${PAWN_IDENTIFIER_SOURCE})\\b`));
        if (!memberMatch) {
            return undefined;
        }

        const className = resolveThisClassName(document, wordRange.start.line);
        if (!className) {
            return undefined;
        }

        const memberName = memberMatch[1];
        const memberStart = wordRange.end.character + memberMatch[0].indexOf(memberName);
        return {
            kind: "member",
            className,
            memberName,
            callable: /^\s*\(/.test(afterWord.slice(memberMatch[0].indexOf(memberName) + memberName.length)),
            originRange: new vscode.Range(
                wordRange.start,
                new vscode.Position(wordRange.start.line, memberStart + memberName.length)
            )
        };
    }

    const beforeWord = line.slice(0, wordRange.start.character);
    if (!/\.\s*$/.test(beforeWord)) {
        return undefined;
    }

    const className = resolveMemberAccessClassName(document, beforeWord, wordRange.start, index);
    if (!className) {
        return undefined;
    }

    return {
        kind: "member",
        className,
        memberName: word,
        callable: /^\s*\(/.test(afterWord),
        originRange: wordRange
    };
}

function getPawnClassMemberDeclarationReferenceContext(document, wordRange) {
    const activeClass = getEnclosingPawnClass(document, wordRange.start.line);
    if (!activeClass || activeClass.braceDepth !== activeClass.depth) {
        return undefined;
    }

    const line = document.lineAt(wordRange.start.line).text;
    const stripped = stripComments(line, { inBlock: false });
    const code = maskStrings(stripped);
    const member = parseClassMemberDeclaration(stripped, code, activeClass.name);
    if (!member) {
        return undefined;
    }

    const cursorStart = wordRange.start.character;
    const cursorEnd = wordRange.end.character;
    if (cursorStart < member.start || cursorEnd > member.end) {
        return undefined;
    }

    return {
        kind: "member",
        className: activeClass.name,
        memberName: member.name,
        callable: member.kind !== "class-field",
        originRange: wordRange
    };
}

function getPawnClassNameReferenceContext(document, wordRange, word, index) {
    if (!isKnownPawnClass(index, word)) {
        return undefined;
    }

    const line = document.lineAt(wordRange.start.line).text;
    const beforeWord = line.slice(0, wordRange.start.character);
    const afterWord = line.slice(wordRange.end.character);
    const classDeclaration = parsePawnClassDeclaration(line);

    if (
        classDeclaration &&
        wordRange.start.character >= classDeclaration.nameStart &&
        wordRange.end.character <= classDeclaration.nameEnd
    ) {
        return {
            kind: "class",
            className: word,
            preferConstructor: false,
            originRange: wordRange
        };
    }

    if (
        classDeclaration?.parentName === word &&
        wordRange.start.character >= classDeclaration.parentStart &&
        wordRange.end.character <= classDeclaration.parentEnd
    ) {
        return {
            kind: "class",
            className: word,
            preferConstructor: false,
            originRange: wordRange
        };
    }

    if (/\bnew\s*$/.test(beforeWord) && /^\s*\(/.test(afterWord)) {
        return {
            kind: "class",
            className: word,
            preferConstructor: true,
            arity: getCallArity(afterWord),
            originRange: wordRange
        };
    }

    for (const item of parseClassVariableDeclarationItems(line, (name) => isKnownPawnClass(index, name), false)) {
        if (wordRange.start.character >= item.classStart && wordRange.end.character <= item.classEnd) {
            return {
                kind: "class",
                className: word,
                preferConstructor: false,
                originRange: wordRange
            };
        }
    }

    for (const record of parseClassParameterDeclarations(line, document.uri, wordRange.start.line, (name) => isKnownPawnClass(index, name))) {
        if (wordRange.start.character >= record.classStart && wordRange.end.character <= record.classEnd) {
            return {
                kind: "class",
                className: word,
                preferConstructor: false,
                originRange: wordRange
            };
        }
    }

    if (
        /^\s*(?::|[&*]?\s*[A-Za-z_])/.test(afterWord) &&
        /(?:^|[\s,(])(?:const\s+|owned\s+|static\s+|new\s+)*$/.test(beforeWord)
    ) {
        return {
            kind: "class",
            className: word,
            preferConstructor: false,
            originRange: wordRange
        };
    }

    return undefined;
}

function getCallArity(text) {
    const open = text.indexOf("(");
    if (open === -1) {
        return undefined;
    }

    let depth = 0;
    let quote = false;
    for (let index = open; index < text.length; index++) {
        const char = text[index];
        if (char === "\"" && text[index - 1] !== "\\") {
            quote = !quote;
        } else if (!quote && char === "(") {
            depth++;
        } else if (!quote && char === ")" && --depth === 0) {
            const argumentsText = text.slice(open + 1, index).trim();
            return argumentsText ? splitTopLevelSegments(argumentsText, 0).length : 0;
        }
    }
    return undefined;
}

function resolveMemberAccessClassName(document, beforeMember, position, index) {
    const explicitTagMatch = beforeMember.match(new RegExp(`\\b(${PAWN_IDENTIFIER_SOURCE})\\s*:\\s*[^;{}]*\\.\\s*$`));
    if (explicitTagMatch && isKnownPawnClass(index, explicitTagMatch[1])) {
        return explicitTagMatch[1];
    }

    const ownerMatch = beforeMember.match(new RegExp(`\\b(${PAWN_IDENTIFIER_SOURCE})(?:\\s*\\[[^\\]]*\\])*\\s*\\.\\s*$`));
    if (!ownerMatch) {
        return undefined;
    }

    const ownerName = ownerMatch[1];
    if (ownerName === "this") {
        return resolveThisClassName(document, position.line);
    }

    if (isKnownPawnClass(index, ownerName)) {
        return ownerName;
    }

    return findPawnClassVariableType(document, ownerName, position, index);
}

function resolveThisClassName(document, lineNumber) {
    const activeClass = getEnclosingPawnClass(document, lineNumber);
    if (activeClass) {
        return activeClass.name;
    }

    return getActiveThisTag(document, lineNumber);
}

function findPawnClassVariableType(document, variableName, position, index) {
    const localRecord = findLocalClassVariableDefinition(document, variableName, position, index);
    if (localRecord) {
        return localRecord.className;
    }

    const records = index.findClassVariable(variableName);
    if (!records.length) {
        return undefined;
    }

    const documentUri = document.uri.toString();
    const sameDocument = records
        .filter((record) => record.uri.toString() === documentUri && record.range.start.line <= position.line)
        .sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
    if (sameDocument.length) {
        return sameDocument[0].className;
    }

    return records[0].className;
}

function findLocalClassVariableDefinition(document, variableName, position, index) {
    const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const lines = getLines(text);
    const commentState = { inBlock: false };
    let result = undefined;

    for (const item of lines) {
        const stripped = stripComments(item.text, commentState);
        const records = parseClassVariableDeclarations(
            stripped,
            document.uri,
            item.line,
            (name) => isKnownPawnClass(index, name),
            false
        );
        records.push(...parseClassParameterDeclarations(
            stripped,
            document.uri,
            item.line,
            (name) => isKnownPawnClass(index, name)
        ));

        for (const record of records) {
            if (record.name === variableName) {
                result = record;
            }
        }
    }

    return result;
}

function getEnclosingPawnClass(document, lineNumber) {
    const commentState = { inBlock: false };
    let braceDepth = 0;
    let activeClass = undefined;
    let pendingClass = undefined;

    for (let line = 0; line <= lineNumber; line++) {
        const stripped = stripComments(document.lineAt(line).text, commentState);
        const code = maskStrings(stripped);
        const classDeclaration = !activeClass && braceDepth === 0 ? parsePawnClassDeclaration(stripped) : undefined;

        if (classDeclaration) {
            if (code.includes("{")) {
                activeClass = {
                    name: classDeclaration.name,
                    depth: braceDepth + 1,
                    line
                };
                pendingClass = undefined;
            } else {
                pendingClass = classDeclaration.name;
            }
        } else if (!activeClass && pendingClass && braceDepth === 0 && code.includes("{")) {
            activeClass = {
                name: pendingClass,
                depth: braceDepth + 1,
                line
            };
            pendingClass = undefined;
        }

        if (line === lineNumber) {
            return activeClass ? { ...activeClass, braceDepth } : undefined;
        }

        const nextDepth = updateBraceDepth(braceDepth, code);
        if (activeClass && nextDepth < activeClass.depth) {
            activeClass = undefined;
        }
        braceDepth = nextDepth;
    }

    return undefined;
}

function isKnownPawnClass(index, name) {
    return Boolean(index && index.findClass(name).length);
}

function getThisMethodCallContext(document, wordRange, word) {
    const line = document.lineAt(wordRange.start.line).text;
    const tag = getActiveThisTag(document, wordRange.start.line);
    if (!tag) {
        return undefined;
    }

    if (word === "this") {
        const afterWord = line.slice(wordRange.end.character);
        const methodMatch = afterWord.match(/^\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (!methodMatch) {
            return undefined;
        }

        const method = methodMatch[1];
        const methodStart = wordRange.end.character + methodMatch[0].indexOf(method);
        return {
            tag,
            method,
            originRange: new vscode.Range(
                wordRange.start,
                new vscode.Position(wordRange.start.line, methodStart + method.length)
            )
        };
    }

    const beforeWord = line.slice(0, wordRange.start.character);
    if (!/\bthis\s*\.\s*$/.test(beforeWord)) {
        return undefined;
    }

    const afterWord = line.slice(wordRange.end.character);
    if (!/^\s*\(/.test(afterWord)) {
        return undefined;
    }

    return {
        tag,
        method: word,
        originRange: wordRange
    };
}

function getActiveThisTag(document, lineNumber) {
    const commentState = { inBlock: false };
    let tag;

    for (let line = 0; line <= lineNumber; line++) {
        const stripped = stripComments(document.lineAt(line).text, commentState);

        if (OOP_THIS_UNDEF_RE.test(stripped)) {
            tag = undefined;
            continue;
        }

        const defineMatch = stripped.match(OOP_THIS_DEFINE_RE);
        if (defineMatch) {
            tag = defineMatch[1];
        }
    }

    return tag;
}

function getNamespacedAliasName(word) {
    if (word.includes("::")) {
        return undefined;
    }

    const underscore = word.indexOf("_");
    if (underscore <= 0 || underscore >= word.length - 1) {
        return undefined;
    }

    return `${word.slice(0, underscore)}::${word.slice(underscore + 1)}`;
}

function getReferenceContext(document, wordRange) {
    const line = document.lineAt(wordRange.start.line).text;
    const beforeWord = line.slice(0, wordRange.start.character);
    const tagMatch = beforeWord.match(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    const externalDeclaration = getGlobalForeignDeclarationContext(line, wordRange);
    const functionDeclarationName = getFunctionDeclarationContext(line, wordRange);
    return {
        tag: tagMatch ? tagMatch[1] : undefined,
        declarationKind: externalDeclaration ? externalDeclaration.kind : undefined,
        declarationName: externalDeclaration ? externalDeclaration.name : undefined,
        functionDeclarationName
    };
}

function getFunctionDeclarationContext(line, wordRange) {
    const header = parseFunctionHeader(line);
    if (!header) {
        return undefined;
    }

    const name = header.name;
    const nameStart = header.nameStart;
    const cursorStart = wordRange.start.character;
    const cursorEnd = wordRange.end.character;
    const prefix = line.slice(0, nameStart);
    const suffix = line.slice(nameStart + name.length);
    const isDefinitionLike = header.modifiers.length > 0 || /\([^;]*\)\s*(?:\{|$)/.test(suffix);
    if (isDefinitionLike && cursorStart >= nameStart && cursorEnd <= nameStart + name.length) {
        return name;
    }

    return undefined;
}

function getGlobalForeignDeclarationContext(line, wordRange) {
    const header = parseFunctionHeader(line);
    const keyword = header?.modifiers.find((modifier) => modifier === "global" || modifier === "foreign");
    if (!header || !keyword) {
        return undefined;
    }

    const name = header.name;
    const keywordStart = line.indexOf(keyword);
    const nameStart = header.nameStart;
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

function addNumericValue(map, name, kind, value, uri, lineNumber, startCharacter, endCharacter) {
    addNumericValueRecord(map, makeNumericValueRecord(name, kind, value, uri, lineNumber, startCharacter, endCharacter));
}

function addNumericValueRecord(map, record) {
    const current = map.get(record.name);
    if (current) {
        current.ambiguous ||= current.value !== record.value;
        current.kind = record.kind;
        current.declarations.push(record);
    } else {
        map.set(record.name, {
            name: record.name,
            kind: record.kind,
            value: record.value,
            ambiguous: false,
            declarations: [record]
        });
    }
}

function addRecord(map, record) {
    const current = map.get(record.name);
    if (current) {
        current.push(record);
    } else {
        map.set(record.name, [record]);
    }
}

function addRecordByKey(map, key, record) {
    const current = map.get(key);
    if (current) {
        current.push(record);
    } else {
        map.set(key, [record]);
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

function makeNumericValueRecord(name, kind, value, uri, lineNumber, startCharacter, endCharacter) {
    return {
        name,
        kind,
        value,
        uri,
        range: new vscode.Range(
            new vscode.Position(lineNumber, Math.max(0, startCharacter)),
            new vscode.Position(lineNumber, Math.max(0, endCharacter))
        )
    };
}

function makeRecordFromOffsets(name, kind, uri, text, startOffset, endOffset) {
    return {
        name,
        kind,
        uri,
        range: new vscode.Range(
            offsetToPosition(text, startOffset),
            offsetToPosition(text, endOffset)
        )
    };
}

function offsetToPosition(text, offset) {
    let line = 0;
    let character = 0;
    const cappedOffset = Math.max(0, Math.min(offset, text.length));

    for (let index = 0; index < cappedOffset; index++) {
        if (text[index] === "\n") {
            line++;
            character = 0;
        } else {
            character++;
        }
    }

    return new vscode.Position(line, character);
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

function makeDefinitionLink(record, originSelectionRange) {
    return {
        originSelectionRange,
        targetUri: record.uri,
        targetRange: record.range,
        targetSelectionRange: record.range
    };
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

function parseNumericValueFromText(text) {
    if (!text) {
        return undefined;
    }

    let value = text.trim().replace(/;+$/, "").trim();
    value = unwrapOuterParens(value);

    const tagMatch = value.match(/^(Float|Int)\s*:\s*(.+)$/i);
    if (tagMatch) {
        value = unwrapOuterParens(tagMatch[2].trim());
    }

    const numericMatch = value.match(/^([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)$/);
    if (!numericMatch) {
        return undefined;
    }

    const label = numericMatch[1].replace(/^\+/, "");
    return label.length <= 24 ? label : undefined;
}

function unwrapOuterParens(value) {
    let current = value.trim();
    while (isWrappedInOuterParens(current)) {
        current = current.slice(1, -1).trim();
    }

    return current;
}

function isWrappedInOuterParens(value) {
    if (value.length < 2 || value[0] !== "(" || value[value.length - 1] !== ")") {
        return false;
    }

    let depth = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (char === "(") {
            depth++;
        } else if (char === ")") {
            depth--;
            if (depth === 0 && index !== value.length - 1) {
                return false;
            }
        }

        if (depth < 0) {
            return false;
        }
    }

    return depth === 0;
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

function findStringLiteralAtOffset(text, offset) {
    for (let index = 0; index < text.length;) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "/" && next === "/") {
            const newline = text.indexOf("\n", index + 2);
            const end = newline === -1 ? text.length : newline;
            if (offset >= index && offset <= end) {
                return undefined;
            }

            index = newline === -1 ? text.length : newline + 1;
            continue;
        }

        if (char === "/" && next === "*") {
            const close = text.indexOf("*/", index + 2);
            const end = close === -1 ? text.length : close + 2;
            if (offset >= index && offset <= end) {
                return undefined;
            }

            index = end;
            continue;
        }

        if (char !== "\"" && char !== "'") {
            index++;
            continue;
        }

        const quote = char;
        const start = index;
        const contentStart = index + 1;
        let cursor = contentStart;

        while (cursor < text.length) {
            const current = text[cursor];
            const after = text[cursor + 1];
            if (current === "\\" && after) {
                cursor += 2;
                continue;
            }

            if (current === quote) {
                break;
            }

            cursor++;
        }

        const closed = cursor < text.length;
        const contentEnd = closed ? cursor : text.length;
        const end = closed ? cursor + 1 : text.length;
        if (offset >= contentStart && offset <= contentEnd) {
            return {
                quote,
                start,
                end,
                contentStart,
                contentEnd,
                closed
            };
        }

        index = end;
    }

    return undefined;
}

function getCallStackAtOffset(text, offset) {
    const stack = [];

    for (let index = 0; index < offset;) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "/" && next === "/") {
            const newline = text.indexOf("\n", index + 2);
            index = newline === -1 ? offset : Math.min(offset, newline + 1);
            continue;
        }

        if (char === "/" && next === "*") {
            const close = text.indexOf("*/", index + 2);
            index = close === -1 ? offset : Math.min(offset, close + 2);
            continue;
        }

        if (char === "\"" || char === "'") {
            index = Math.min(offset, skipStringLiteral(text, index));
            continue;
        }

        if (char === "(") {
            stack.push({
                name: getIdentifierBeforeParen(text, index),
                open: index,
                argIndex: 0
            });
            index++;
            continue;
        }

        if (char === ")") {
            stack.pop();
            index++;
            continue;
        }

        if (char === "," && stack.length) {
            stack[stack.length - 1].argIndex++;
        }

        index++;
    }

    return stack;
}

function getIdentifierBeforeParen(text, openIndex) {
    let index = openIndex - 1;
    while (index >= 0 && /\s/.test(text[index])) {
        index--;
    }

    const end = index + 1;
    while (index >= 0 && /[A-Za-z0-9_]/.test(text[index])) {
        index--;
    }

    const start = index + 1;
    const value = text.slice(start, end);
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : undefined;
}

function parsePawnCalls(text, names) {
    const calls = [];
    const loweredNames = new Set(Array.from(names).map((name) => name.toLowerCase()));
    let index = 0;

    while (index < text.length) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "/" && next === "/") {
            const newline = text.indexOf("\n", index + 2);
            index = newline === -1 ? text.length : newline + 1;
            continue;
        }

        if (char === "/" && next === "*") {
            const close = text.indexOf("*/", index + 2);
            index = close === -1 ? text.length : close + 2;
            continue;
        }

        if (char === "\"" || char === "'") {
            index = skipStringLiteral(text, index);
            continue;
        }

        if (!/[A-Za-z_]/.test(char)) {
            index++;
            continue;
        }

        const nameStart = index;
        index++;
        while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) {
            index++;
        }

        const name = text.slice(nameStart, index);
        if (!loweredNames.has(name.toLowerCase())) {
            continue;
        }

        let open = index;
        while (open < text.length && /\s/.test(text[open])) {
            open++;
        }

        if (text[open] !== "(") {
            continue;
        }

        const close = findMatchingParen(text, open);
        if (close === -1) {
            continue;
        }

        calls.push({
            name,
            start: nameStart,
            open,
            close,
            end: close + 1,
            args: splitCallArguments(text.slice(open + 1, close), open + 1)
        });
        index = close + 1;
    }

    return calls;
}

function findMatchingParen(text, openIndex) {
    let depth = 0;

    for (let index = openIndex; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "/" && next === "/") {
            const newline = text.indexOf("\n", index + 2);
            index = newline === -1 ? text.length : newline;
            continue;
        }

        if (char === "/" && next === "*") {
            const close = text.indexOf("*/", index + 2);
            index = close === -1 ? text.length : close + 1;
            continue;
        }

        if (char === "\"" || char === "'") {
            index = skipStringLiteral(text, index) - 1;
            continue;
        }

        if (char === "(") {
            depth++;
        } else if (char === ")") {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function splitCallArguments(text, absoluteOffset) {
    const args = [];
    let start = 0;
    let parenDepth = 0;
    let squareDepth = 0;
    let braceDepth = 0;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "/" && next === "/") {
            const newline = text.indexOf("\n", index + 2);
            index = newline === -1 ? text.length : newline;
            continue;
        }

        if (char === "/" && next === "*") {
            const close = text.indexOf("*/", index + 2);
            index = close === -1 ? text.length : close + 1;
            continue;
        }

        if (char === "\"" || char === "'") {
            index = skipStringLiteral(text, index) - 1;
            continue;
        }

        if (char === "(") {
            parenDepth++;
        } else if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
        } else if (char === "[") {
            squareDepth++;
        } else if (char === "]") {
            squareDepth = Math.max(0, squareDepth - 1);
        } else if (char === "{") {
            braceDepth++;
        } else if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
        } else if (char === "," && parenDepth === 0 && squareDepth === 0 && braceDepth === 0) {
            addCallArgument(args, text.slice(start, index), absoluteOffset + start);
            start = index + 1;
        }
    }

    addCallArgument(args, text.slice(start), absoluteOffset + start);
    return args;
}

function addCallArgument(args, text, offset) {
    const leading = text.match(/^\s*/)[0].length;
    const trailing = text.match(/\s*$/)[0].length;
    const value = text.slice(leading, text.length - trailing);
    args.push({ text: value, offset: offset + leading });
}

function extractStringLiterals(text, absoluteOffset) {
    const literals = [];

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];

        if (char === "/" && next === "/") {
            const newline = text.indexOf("\n", index + 2);
            index = newline === -1 ? text.length : newline;
            continue;
        }

        if (char === "/" && next === "*") {
            const close = text.indexOf("*/", index + 2);
            index = close === -1 ? text.length : close + 1;
            continue;
        }

        if (char !== "\"" && char !== "'") {
            continue;
        }

        const quote = char;
        const contentStart = index + 1;
        let cursor = contentStart;
        let value = "";

        while (cursor < text.length) {
            const current = text[cursor];
            const after = text[cursor + 1];
            if (current === "\\" && after) {
                value += current + after;
                cursor += 2;
                continue;
            }

            if (current === quote) {
                break;
            }

            value += current;
            cursor++;
        }

        if (cursor >= text.length) {
            break;
        }

        literals.push({
            value,
            raw: text.slice(contentStart, cursor),
            start: absoluteOffset + index,
            end: absoluteOffset + cursor + 1,
            contentStart: absoluteOffset + contentStart,
            contentEnd: absoluteOffset + cursor
        });
        index = cursor;
    }

    return literals;
}

function getFirstStringLiteral(argument) {
    if (!argument) {
        return undefined;
    }

    return extractStringLiterals(argument.text, argument.offset)[0];
}

function getJoinedStringLiterals(argument) {
    if (!argument) {
        return undefined;
    }

    const literals = extractStringLiterals(argument.text, argument.offset);
    if (!literals.length) {
        return undefined;
    }

    return {
        value: literals.map((literal) => literal.value).join(""),
        contentStart: literals[0].contentStart,
        contentEnd: literals[literals.length - 1].contentEnd
    };
}

function skipStringLiteral(text, startIndex) {
    const quote = text[startIndex];
    let index = startIndex + 1;

    while (index < text.length) {
        const char = text[index];
        const next = text[index + 1];
        if (char === "\\" && next) {
            index += 2;
            continue;
        }

        if (char === quote) {
            return index + 1;
        }

        index++;
    }

    return text.length;
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

async function generateEnumFromCreateTableCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isPawnDocument(editor.document)) {
        vscode.window.showWarningMessage("Open a Pawn file and select a CREATE TABLE statement first.");
        return;
    }

    const selection = editor.selection;
    const selectedText = selection && !selection.isEmpty ? editor.document.getText(selection) : "";
    const sourceText = selectedText || getSqlTextAtPosition(editor.document, editor.selection.active);
    const enumText = generateEnumFromCreateTable(sourceText);
    if (!enumText) {
        vscode.window.showWarningMessage("No CREATE TABLE statement found near the cursor or in the selection.");
        return;
    }

    const insertPosition = selection && !selection.isEmpty ? selection.end : editor.selection.active;
    const prefix = insertPosition.character === 0 ? "" : "\n";
    await editor.edit((edit) => {
        edit.insert(insertPosition, `${prefix}\n${enumText}\n`);
    });
    await vscode.env.clipboard.writeText(enumText);
    vscode.window.setStatusBarMessage("NeoPawn Helper: enum из CREATE TABLE скопирован в буфер обмена", 3000);
}

function getSqlTextAtPosition(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const literal = extractStringLiterals(text, 0).find((item) => offset >= item.start && offset <= item.end);
    if (literal) {
        return literal.value;
    }

    const before = Math.max(0, offset - 6000);
    const after = Math.min(text.length, offset + 6000);
    return text.slice(before, after);
}

function generateEnumFromCreateTable(sourceText) {
    const sql = normalizeSqlSource(sourceText);
    const table = parseCreateTableStatement(sql);
    if (!table) {
        return undefined;
    }

    const columns = splitSqlColumns(table.body)
        .map(parseSqlColumnName)
        .filter(Boolean);
    if (!columns.length) {
        return undefined;
    }

    const enumName = `E_${toPawnEnumName(table.name)}`;
    const prefix = toPawnEnumName(table.name);
    const lines = [`enum ${enumName}`, "{"];
    for (const column of columns) {
        lines.push(`    ${prefix}_${toPawnEnumName(column)},`);
    }
    lines.push("};");
    return lines.join("\n");
}

function parseCreateTableStatement(sql) {
    const headRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([A-Za-z0-9_]+))\s*\(/i;
    const match = headRe.exec(sql);
    if (!match) {
        return undefined;
    }

    const open = match.index + match[0].length - 1;
    const close = findSqlMatchingParen(sql, open);
    if (close === -1) {
        return undefined;
    }

    return {
        name: match[1] || match[2] || match[3] || match[4],
        body: sql.slice(open + 1, close)
    };
}

function findSqlMatchingParen(sql, openIndex) {
    let depth = 0;
    let quote = "";
    let inBacktick = false;

    for (let index = openIndex; index < sql.length; index++) {
        const char = sql[index];
        const next = sql[index + 1];

        if (quote) {
            if (char === "\\" && next) {
                index++;
            } else if (char === quote) {
                quote = "";
            }
            continue;
        }

        if (inBacktick) {
            if (char === "`") {
                inBacktick = false;
            }
            continue;
        }

        if (char === "'" || char === "\"") {
            quote = char;
        } else if (char === "`") {
            inBacktick = true;
        } else if (char === "(") {
            depth++;
        } else if (char === ")") {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function normalizeSqlSource(sourceText) {
    const literals = extractStringLiterals(sourceText, 0);
    if (!literals.length) {
        return sourceText;
    }

    return literals.map((literal) => literal.value).join(" ");
}

function splitSqlColumns(body) {
    const columns = [];
    let start = 0;
    let parenDepth = 0;
    let quote = "";
    let inBacktick = false;

    for (let index = 0; index < body.length; index++) {
        const char = body[index];
        const next = body[index + 1];

        if (quote) {
            if (char === "\\" && next) {
                index++;
            } else if (char === quote) {
                quote = "";
            }
            continue;
        }

        if (inBacktick) {
            if (char === "`") {
                inBacktick = false;
            }
            continue;
        }

        if (char === "'" || char === "\"") {
            quote = char;
        } else if (char === "`") {
            inBacktick = true;
        } else if (char === "(") {
            parenDepth++;
        } else if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
        } else if (char === "," && parenDepth === 0) {
            columns.push(body.slice(start, index));
            start = index + 1;
        }
    }

    columns.push(body.slice(start));
    return columns;
}

function parseSqlColumnName(segment) {
    const trimmed = segment.trim();
    if (!trimmed || /^(PRIMARY|KEY|UNIQUE|INDEX|CONSTRAINT|FOREIGN|CHECK|FULLTEXT|SPATIAL)\b/i.test(trimmed)) {
        return undefined;
    }

    const match = trimmed.match(/^(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/);
    return match ? (match[1] || match[2] || match[3] || match[4]) : undefined;
}

function toPawnEnumName(value) {
    return String(value)
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase() || "TABLE";
}

function getConfig() {
    return vscode.workspace.getConfiguration("neoPawnHelper");
}

function isPawnDocument(document) {
    if (!document) {
        return false;
    }

    return document.languageId === "pawn" || /\.(pwn|inc|module)$/i.test(document.fileName);
}

module.exports = {
    activate,
    deactivate,
    _test: {
        PawnIndex,
        parsePawnClassDeclaration,
        parseClassMemberDeclaration,
        parseClassVariableDeclarationItems,
        parseClassParameterDeclarations,
        parseFunctionDefinition,
        parseFunctionParameters,
        parseGlobalDeclarations,
        parseNumericConstDeclarations,
        collectNumericValueHints,
        buildPawnSemanticTokens,
        PAWN_SEMANTIC_TYPES,
        decodePawnBytes,
        getCallArity,
        getPawnClassReferenceContext,
        scanPawnTextToEntry
    }
};
