import { expect, test } from "vitest";
import { browserCommand } from "../src/open";

test("on Windows the whole link reaches the browser, key and all", () => {
  const link = "http://127.0.0.1:47114/?live=47114&key=abc123";
  const [cmd, args] = browserCommand(link, "win32");
  expect(cmd).not.toBe("cmd"); // the Command Prompt would cut the link at "&"
  expect(args).toContain(link);
});

test("Mac and Linux open the link as it is", () => {
  expect(browserCommand("http://x/?a=1&b=2", "darwin")).toEqual(["open", ["http://x/?a=1&b=2"]]);
  expect(browserCommand("http://x/?a=1&b=2", "linux")).toEqual(["xdg-open", ["http://x/?a=1&b=2"]]);
});
