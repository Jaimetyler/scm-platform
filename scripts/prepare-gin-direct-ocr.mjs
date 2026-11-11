import { copyFile, mkdir } from "node:fs/promises";

const assets = new URL("../public/gin-direct-ocr/", import.meta.url);
await mkdir(assets, { recursive: true });
const sources = {
  "pdf.worker.min.mjs": "pdfjs-dist/build/pdf.worker.min.mjs",
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};
await Promise.all(Object.entries(sources).map(([name, source]) =>
  copyFile(new URL(`../node_modules/${source}`, import.meta.url), new URL(name, assets)),
));
