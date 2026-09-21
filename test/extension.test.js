"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class Range {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class EventEmitter {
    constructor() {
        this.event = () => ({ dispose() {} });
    }

    fire() {}
    dispose() {}
}

class SemanticTokensBuilder {
    constructor() {
        this.tokens = [];
    }

    push(line, start, length, tokenType) {
        this.tokens.push({ line, start, length, tokenType });
    }

    build() {
        return this.tokens;
    }
}

class InlayHint {
    constructor(position, label, kind) {
        this.position = position;
        this.label = label;
        this.kind = kind;
    }
}

const vscodeMock = {
    Position,
    Range,
    EventEmitter,
    InlayHint,
    InlayHintKind: { Type: 1 },
    SemanticTokensBuilder,
    SemanticTokensLegend: class {},
    workspace: {
        getConfiguration() {
            return { get(_name, fallback) { return fallback; } };
        }
    }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    return request === "vscode" ? vscodeMock : originalLoad(request, parent, isMain);
};

const {
    PawnIndex,
    parsePawnClassDeclaration,
    parseClassMemberDeclaration,
    parseClassVariableDeclarationItems,
    parseClassParameterDeclarations,
    parseFunctionDefinition,
    parseFunctionParameters,
    parseGlobalDeclarations,
    collectNumericValueHints,
    buildPawnSemanticTokens,
    PAWN_SEMANTIC_TYPES,
    decodePawnBytes,
    getCallArity,
    getPawnClassReferenceContext,
    scanPawnTextToEntry
} = require("../extension")._test;
Module._load = originalLoad;

const uri = {
    fsPath: "test.pwn",
    scheme: "file",
    toString() {
        return "file:///test.pwn";
    }
};

function member(line, className) {
    return parseClassMemberDeclaration(line, line.replace(/"[^"]*"/g, "\"\""), className);
}

const declaration = parsePawnClassDeclaration("final class Player[32] extends Entity {");
assert.equal(declaration.modifier, "final");
assert.equal(declaration.name, "Player");
assert.equal(declaration.parentName, "Entity");

const colonDeclaration = parsePawnClassDeclaration("class Admin : Player {");
assert.equal(colonDeclaration.parentName, "Player");

assert.deepEqual(
    {
        name: member("private readonly int score;", "Player").name,
        type: member("private readonly int score;", "Player").typeName
    },
    { name: "score", type: "int" }
);
assert.equal(member("override int GetScore()", "Player").returnType, "int");
assert.equal(member("abstract int Load();", "Player").kind, "class-method");
assert.equal(member("Player(int id, int score)", "Player").arity, 2);
assert.equal(member("~Player()", "Player").kind, "class-destructor");

const owned = parseClassVariableDeclarationItems("owned Player player = new Player();");
assert.equal(owned[0].className, "Player");
assert.equal(owned[0].name, "player");

const tagged = parseClassVariableDeclarationItems("new Player:player;");
assert.equal(tagged[0].className, "Player");
assert.equal(tagged[0].name, "player");

const parameters = parseClassParameterDeclarations(
    "stock System_Use(const Player player, Entity:entity)",
    uri,
    0,
    (name) => name === "Player" || name === "Entity"
);
assert.deepEqual(parameters.map((record) => [record.className, record.name]), [
    ["Player", "player"],
    ["Entity", "entity"]
]);
assert.equal(getCallArity("(1, System_Read(2, 3), \"a,b\")"), 3);
assert.equal(getCallArity("()"), 0);
assert.equal(decodePawnBytes(Buffer.from("тест", "utf8")), "тест");
assert.equal(decodePawnBytes(Buffer.from([0xF2, 0xE5, 0xF1, 0xF2])), "тест");

const cFunction = "int Compiler_Count(int head, va_args<>)";
const functionRecord = parseFunctionDefinition(cFunction, cFunction, uri, 0);
assert.equal(functionRecord.name, "Compiler_Count");
assert.deepEqual(
    parseFunctionParameters(cFunction, functionRecord, uri, 0).map((record) => record.name),
    ["head"]
);
assert.deepEqual(
    parseGlobalDeclarations("const int COMPILER_CHECK_ARGS = 4;", uri, 0).map((record) => record.name),
    ["COMPILER_CHECK_ARGS"]
);
assert.deepEqual(
    parseGlobalDeclarations("new Float:g_Angle, g_Target;", uri, 0).map((record) => record.name),
    ["g_Angle", "g_Target"]
);
assert.equal(parseFunctionDefinition("Float:System_Read(Float:value)", "Float:System_Read(Float:value)", uri, 0).name, "System_Read");
assert.equal(parseFunctionDefinition("forward Legacy(value);", "forward Legacy(value);", uri, 0).name, "Legacy");

const source = [
    "abstract class Entity[32] {",
    "    protected int id;",
    "    Entity(int id) {",
    "    }",
    "    virtual int GetId() {",
    "    }",
    "}",
    "final class Player extends Entity {",
    "    public property int Score;",
    "    Player(int id, int score) {",
    "    }",
    "    override int GetId() {",
    "    }",
    "    ~Player() {",
    "    }",
    "}",
    "owned Player current = new Player(1, 2);"
].join("\n");

const entry = scanPawnTextToEntry(uri, source);
assert(entry.classes.has("Entity"));
assert(entry.classes.has("Player"));
assert.equal(entry.classParents.get("Player").name, "Entity");
assert(entry.classMembers.has("Entity.id"));
assert(entry.classMembers.has("Player.Score"));
assert(entry.classMembers.has("Player.~Player"));
assert(entry.symbols.has("Player_Ctor2"));
assert(entry.symbols.has("Player_New2"));

const index = new PawnIndex();
index.fileEntries.set(uri.toString(), entry);
index.rebuildIndexesFromEntries();
assert.equal(index.findClassMember("Player", "Score")[0].className, "Player");
assert.equal(index.findClassMember("Player", "id")[0].className, "Entity");
assert.equal(index.findClassMember("Player", "GetId")[0].className, "Player");
assert.equal(index.findClassParent("Player").name, "Entity");
assert(index.findClassVariable("current").length === 1);

const constantsEntry = scanPawnTextToEntry(uri, [
    "const int LIMIT = 4;",
    "const char LETTER = 65;",
    "int value = LIMIT;"
].join("\n"));
assert(constantsEntry.numericValues.has("LIMIT"));
assert(constantsEntry.numericValues.has("LETTER"));
assert(!constantsEntry.numericValues.has("int"));
assert(!constantsEntry.numericValues.has("char"));

const legacyEntry = scanPawnTextToEntry(uri, [
    "#define COLOR_RED 0xFF0000FF",
    "#define LEGACY_LIMIT 16",
    "enum E_LEGACY",
    "{",
    "    E_LEGACY_NONE = 0",
    "}",
    "new Float:g_LegacyValue;",
    "stock Float:Legacy::Read(Float:value)",
    "{",
    "    return value;",
    "}",
    "global LegacyGlobal();",
    "foreign LegacyForeign();"
].join("\n"));
for (const name of ["COLOR_RED", "LEGACY_LIMIT", "E_LEGACY", "E_LEGACY_NONE", "g_LegacyValue", "Legacy::Read", "LegacyGlobal", "LegacyForeign"]) {
    assert(legacyEntry.symbols.has(name), `Legacy Pawn symbol ${name} is missing.`);
}
assert(legacyEntry.colors.has("COLOR_RED"));
assert.equal(legacyEntry.numericValues.get("LEGACY_LIMIT").value, "16");

const hintDocument = {
    uri,
    getText() {
        return "int value = LIMIT;\nchar letter = LETTER;";
    },
    positionAt(offset) {
        const before = this.getText().slice(0, offset).split("\n");
        return new Position(before.length - 1, before[before.length - 1].length);
    }
};
const hintIndex = {
    getColor() { return undefined; },
    getNumericValue(name) { return constantsEntry.numericValues.get(name); }
};
const hints = collectNumericValueHints(hintDocument, undefined, hintIndex);
assert.deepEqual(hints.map((hint) => [hint.position.line, hint.position.character, hint.label]), [
    [0, 17, "4"],
    [1, 20, "65"]
]);

const semanticSource = [
    "int Compiler_Count(int head)",
    "{",
    "    int value = head;",
    "    return value;",
    "}"
].join("\n");
const semanticDocument = { getText() { return semanticSource; } };
const semanticTokens = buildPawnSemanticTokens(semanticDocument, index);
function hasSemanticToken(line, text, type) {
    const sourceLine = semanticSource.split("\n")[line];
    const start = sourceLine.indexOf(text);
    return semanticTokens.some((token) =>
        token.line === line && token.start === start && token.length === text.length &&
        PAWN_SEMANTIC_TYPES[token.tokenType] === type
    );
}
assert(hasSemanticToken(0, "int", "type"));
assert(hasSemanticToken(0, "Compiler_Count", "function"));
assert(hasSemanticToken(0, "head", "parameter"));
assert(hasSemanticToken(2, "value", "variable"));

function documentFromLines(lines) {
    return {
        uri,
        lineAt(line) {
            return { text: lines[line] };
        }
    };
}

const inheritanceLine = "final class Player extends Entity {";
const inheritanceDocument = documentFromLines([inheritanceLine]);
const parentStart = inheritanceLine.indexOf("Entity");
const parentContext = getPawnClassReferenceContext(
    inheritanceDocument,
    new Range(new Position(0, parentStart), new Position(0, parentStart + 6)),
    "Entity",
    index
);
assert.equal(parentContext.className, "Entity");

const allocationLine = "Player player = new Player(1, 2);";
const allocationDocument = documentFromLines([allocationLine]);
const allocationStart = allocationLine.lastIndexOf("Player");
const allocationContext = getPawnClassReferenceContext(
    allocationDocument,
    new Range(new Position(0, allocationStart), new Position(0, allocationStart + 6)),
    "Player",
    index
);
assert.equal(allocationContext.preferConstructor, true);
assert.equal(allocationContext.arity, 2);

const baseLines = ["class Player extends Entity {", "    Player() {", "        base(1);"];
const baseDocument = documentFromLines(baseLines);
const baseStart = baseLines[2].indexOf("base");
const baseContext = getPawnClassReferenceContext(
    baseDocument,
    new Range(new Position(2, baseStart), new Position(2, baseStart + 4)),
    "base",
    index
);
assert.equal(baseContext.className, "Entity");
assert.equal(baseContext.arity, 1);

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const grammar = JSON.parse(fs.readFileSync(path.join(root, "syntaxes", "neopawn.tmLanguage.json"), "utf8"));
assert.equal(manifest.name, "neopawn-helper");
assert.equal(manifest.displayName, "NeoPawn Helper");
assert.equal(manifest.version, "1.0.1");
assert(manifest.contributes.grammars.some((item) => item.scopeName === "source.neopawn"));
assert.equal(grammar.scopeName, "source.neopawn");
assert.equal(grammar.repository.types.patterns[0].name, "storage.type.built-in.c");

console.log("NeoPawn Helper: все тесты пройдены.");
