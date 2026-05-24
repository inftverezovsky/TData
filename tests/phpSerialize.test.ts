import test from "node:test";
import assert from "node:assert/strict";
import { phpSerialize } from "../src/lib/adminUpload/phpSerialize";

test("phpSerialize serializes scalar values", () => {
  assert.equal(phpSerialize(null), "N;");
  assert.equal(phpSerialize(true), "b:1;");
  assert.equal(phpSerialize(false), "b:0;");
  assert.equal(phpSerialize(42), "i:42;");
  assert.equal(phpSerialize(3.14), "d:3.14;");
  assert.equal(phpSerialize("test"), 's:4:"test";');
  assert.equal(phpSerialize(""), 's:0:"";');
});

test("phpSerialize uses UTF-8 byte length for strings", () => {
  assert.equal(phpSerialize("тест"), 's:8:"тест";');
});

test("phpSerialize serializes arrays and objects", () => {
  assert.equal(phpSerialize(["a", "b"]), 'a:2:{i:0;s:1:"a";i:1;s:1:"b";}');
  assert.equal(phpSerialize({ sport: 73, title: "Cup" }), 'a:2:{s:5:"sport";i:73;s:5:"title";s:3:"Cup";}');
});
