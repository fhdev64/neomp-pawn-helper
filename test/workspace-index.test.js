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

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (request !== "vscode") {
        return originalLoad(request, parent, isMain);
    }
    return {
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
};

const { PawnIndex, scanPawnTextToEntry } = require("../extension")._test;
Module._load = originalLoad;

const root = path.resolve(process.argv[2] || ".");
const files = [];
function collect(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        if (item.name === ".git" || item.name === "node_modules" || item.name === ".vs") {
            continue;
        }
        const target = path.join(directory, item.name);
        if (item.isDirectory()) {
            collect(target);
        } else if (/\.(?:pwn|inc|module)$/i.test(item.name)) {
            files.push(target);
        }
    }
}
collect(root);
assert(files.length, `В ${root} не найдены Pawn-файлы.`);

const index = new PawnIndex();
for (const file of files) {
    const uri = {
        fsPath: file,
        scheme: "file",
        toString() {
            return `file:///${file.replace(/\\/g, "/")}`;
        }
    };
    index.fileEntries.set(uri.toString(), scanPawnTextToEntry(uri, fs.readFileSync(file, "utf8")));
}
index.rebuildIndexesFromEntries();

let symbols = 0;
for (const records of index.symbols.values()) {
    symbols += records.length;
}

console.log(`NeoPawn Helper: ${files.length} файлов, ${symbols} символов, ${index.classes.size} классов.`);
