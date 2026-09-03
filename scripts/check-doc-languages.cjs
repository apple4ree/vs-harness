const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const marker = "<!-- witch-doc-languages: ko,en -->";
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--", "*.md", "*.mdx"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const failures = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  const missing = [];
  if (!content.includes(marker)) missing.push("language marker");
  if (!/[가-힣]/u.test(content)) missing.push("Korean text");
  if (!/[A-Za-z]/u.test(content)) missing.push("English text");
  if (missing.length) failures.push(`${file}: missing ${missing.join(", ")}`);
}

if (failures.length) {
  console.error("Bilingual documentation check failed:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Bilingual documentation check passed for ${files.length} files.`);
}
