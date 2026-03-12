/**
 * Copy Monaco Editor files to public/vs for self-hosting.
 * Avoids "Tracking Prevention blocked access" when loading from CDN.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "../node_modules/monaco-editor/min/vs");
const dest = path.join(__dirname, "../public/vs");

if (!fs.existsSync(src)) {
  console.warn("Monaco editor not found in node_modules, skipping copy.");
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true });
}
fs.cpSync(src, dest, { recursive: true });
console.log("Monaco editor copied to public/vs");
