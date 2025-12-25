// Message module tests
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import {
  sanitizeMessageBody,
} from "../src/modules/message/index.js";

describe("Message Module", () => {
  describe("sanitizeMessageBody", () => {
    test("should remove HTML tags", () => {
      const input = "Hello <script>alert('xss')</script> World";
      const output = sanitizeMessageBody(input);
      assert.strictEqual(output, "Hello  World");
    });

    test("should remove multiple HTML tags", () => {
      const input = "<b>Bold</b> <i>Italic</i> <u>Underline</u>";
      const output = sanitizeMessageBody(input);
      assert.strictEqual(output, "Bold Italic Underline");
    });

    test("should handle nested HTML tags", () => {
      const input = "<div><span>Nested</span></div>";
      const output = sanitizeMessageBody(input);
      assert.strictEqual(output, "Nested");
    });

    test("should handle empty tags", () => {
      const input = "Text<br/>More<hr/>";
      const output = sanitizeMessageBody(input);
      assert.strictEqual(output, "TextMore");
    });

    test("should handle malformed HTML", () => {
      const input = "Text<b>Bold<i>Italic</b>Text";
      const output = sanitizeMessageBody(input);
      assert.strictEqual(output, "TextBoldItalicText");
    });

    test("should handle empty string", () => {
      const output = sanitizeMessageBody("");
      assert.strictEqual(output, "");
    });

    test("should handle null", () => {
      const output = sanitizeMessageBody(null);
      assert.strictEqual(output, "");
    });

    test("should handle undefined", () => {
      const output = sanitizeMessageBody(undefined);
      assert.strictEqual(output, "");
    });

    test("should handle non-string input", () => {
      const output = sanitizeMessageBody(123);
      assert.strictEqual(output, "");
    });

    test("should preserve plain text", () => {
      const input = "Just plain text without any HTML";
      const output = sanitizeMessageBody(input);
      assert.strictEqual(output, input);
    });

    test("should handle special characters", () => {
      const input = "Text with & characters";
      const output = sanitizeMessageBody(input);
      assert.strictEqual(output, "Text with &amp; characters");
    });
  });
});
