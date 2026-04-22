import { createReadStream, createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [constantKey, sourcePath, outDir = `data/${constantKey}`, chunkSizeValue = "1000000"] = process.argv.slice(2);

if (!constantKey || !sourcePath) {
  console.error("Usage: node tools/chunk-digits.js <constant> <source.txt> [outDir] [chunkSize]");
  process.exit(1);
}

const labels = {
  pi: ["π", "圆周率 π"],
  e: ["e", "自然常数 e"]
};

const chunkSize = Number(chunkSizeValue);
const targetDir = resolve(outDir);
mkdirSync(targetDir, { recursive: true });

let buffer = "";
let totalDigits = 0;
let chunkIndex = 0;
const chunks = [];

function writeChunk(content) {
  const name = `chunk-${String(chunkIndex).padStart(6, "0")}.txt`;
  const file = join(targetDir, name);
  writeFileSync(file, content);
  chunks.push(name);
  totalDigits += content.length;
  chunkIndex += 1;
}

createReadStream(resolve(sourcePath), { encoding: "utf8" })
  .on("data", (chunk) => {
    buffer += chunk.replace(/\D/g, "");
    while (buffer.length >= chunkSize) {
      writeChunk(buffer.slice(0, chunkSize));
      buffer = buffer.slice(chunkSize);
    }
  })
  .on("end", () => {
    if (buffer.length) writeChunk(buffer);

    const [label, fullName] = labels[constantKey] || [constantKey, constantKey];
    const manifest = {
      key: constantKey,
      label,
      fullName,
      source: basename(sourcePath),
      availableDigits: totalDigits,
      chunkSize,
      chunks
    };

    writeFileSync(join(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${totalDigits} digits in ${chunks.length} chunks to ${targetDir}`);
  })
  .on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
