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

const vscodeMock = {
    Position,
    Range,
    EventEmitter,
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
assert.equal(manifest.version, "1.0.0");
assert(manifest.contributes.grammars.some((item) => item.scopeName === "source.neopawn"));
assert.equal(grammar.scopeName, "source.neopawn");

console.log("NeoPawn Helper: все тесты пройдены.");
