const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { basename } = require("node:path");

const files = execFileSync(
  "git",
  ["ls-files", "-z", "--", "*.md", "*.mdx"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const fileSet = new Set(files);
const koreanPath = (file) => file.replace(/(\.mdx?)$/, ".ko$1");
const englishPath = (file) => file.replace(/\.ko(\.mdx?)$/, "$1");

const failures = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (/\.ko\.mdx?$/.test(file)) {
    const pair = englishPath(file);
    if (!fileSet.has(pair)) failures.push(`${file}: missing English pair ${pair}`);
    if (
      !content.includes(`[한국어](${basename(file)})`) ||
      !content.includes(`[English](${basename(pair)})`)
    )
      failures.push(`${file}: missing reciprocal language navigation`);
    if (!/[가-힣]/u.test(content)) failures.push(`${file}: missing Korean text`);
  } else {
    const pair = koreanPath(file);
    if (!fileSet.has(pair)) failures.push(`${file}: missing Korean pair ${pair}`);
    if (
      !content.includes(`[English](${basename(file)})`) ||
      !content.includes(`[한국어](${basename(pair)})`)
    )
      failures.push(`${file}: missing reciprocal language navigation`);
    if (!/[A-Za-z]/u.test(content)) failures.push(`${file}: missing English text`);
  }
}

if (failures.length) {
  console.error("Documentation locale-pair check failed:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation locale-pair check passed for ${files.length / 2} pairs.`);
}
