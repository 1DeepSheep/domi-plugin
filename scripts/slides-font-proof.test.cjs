const assert = require("node:assert/strict");
const test = require("node:test");
const { inspectRenderedFonts } = require("../skills/slides/scripts/qa_deck.js");

test("actual Chinese bold cannot pass using a regular face with CSS weight 700", async () => {
  const fonts = [{ familyName: "Kaiti SC", postScriptName: "STKaitiSC-Regular", glyphCount: 3 }];
  const page = { context: () => ({ newCDPSession: async () => ({
    send: async method => method === "DOM.getDocument" ? { root: { nodeId: 1 } }
      : method === "DOM.querySelectorAll" ? { nodeIds: [2] }
      : method === "CSS.getPlatformFontsForNode" ? { fonts } : {},
    detach: async () => {}
  }) }) };
  const sample = [{ text: "中文标题", fontWeight: "700", domIndex: 0 }];
  assert.match((await inspectRenderedFonts(page, sample, "Calibri", "Kaiti SC"))[0].error, /regular font face/);
  fonts[0].postScriptName = "STKaitiSC-Bold";
  assert.deepEqual(await inspectRenderedFonts(page, sample, "Calibri", "Kaiti SC"), []);
  fonts[0].familyName = "PingFang SC"; fonts[0].postScriptName = "PingFangSC-Bold";
  assert.notEqual((await inspectRenderedFonts(page, sample, "Calibri", "Kaiti SC")).length, 0);
});
