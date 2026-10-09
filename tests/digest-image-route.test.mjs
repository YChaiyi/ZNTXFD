import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadModule(filename, dependencies) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const data = loadModule("src/lib/data.ts", {
  fs,
  path,
  "@/config/tokenRank": { TOKEN_RANK_CONFIG: {} },
});

class NextResponse extends Response {}

function routeFixture() {
  const opened = [];
  const route = loadModule("src/app/digest-images/[date]/[filename]/route.ts", {
    fs: {
      promises: {
        async open(filename) {
          opened.push(filename);
          return {
            async stat() { return { size: 3, isFile: () => true }; },
            async readFile() { return Uint8Array.from([1, 2, 3]); },
            async close() {},
          };
        },
      },
    },
    "next/server": { NextResponse },
    "@/lib/data": {
      ...data,
      getDigestImageFilePath: (date, filename) => `${date}/${filename}`,
    },
  });
  return {
    opened,
    get(date, filename) {
      return route.GET(new Request("http://localhost/"), {
        params: Promise.resolve({ date, filename }),
      });
    },
  };
}

test("serves AVIF and PNG for every registered active digest group", async () => {
  const route = routeFixture();
  for (const group of data.DIGEST_GROUPS) {
    for (const extension of ["avif", "png"]) {
      const response = await route.get(group.activeFrom, `${group.key}.${extension}`);
      assert.equal(response.status, 200, `${group.key}.${extension}`);
      assert.equal(response.headers.get("Content-Type"), `image/${extension}`);
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
    }
  }
  assert.equal(route.opened.length, data.DIGEST_GROUPS.length * 2);
});

test("rejects unknown, inactive and unsafe image paths before opening files", async () => {
  const route = routeFixture();
  for (const [date, filename] of [
    ["2026-10-08", "group999.avif"],
    ["2026-10-07", "group15.avif"],
    ["2026-02-30", "group1.avif"],
    ["../2026-10-08", "group1.avif"],
    ["2026-10-08", "../group1.avif"],
    ["2026-10-08", "group1.svg"],
  ]) {
    assert.equal((await route.get(date, filename)).status, 404);
  }
  assert.equal(route.opened.length, 0);
});
