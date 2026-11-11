const assets = "/gin-direct-ocr";

export async function readGinDirectPdfs(files: File[], onProgress: (message: string) => void) {
  const [{ getDocument, GlobalWorkerOptions }, { createWorker, PSM }] = await Promise.all([
    import("pdfjs-dist"),
    import("tesseract.js"),
  ]);
  GlobalWorkerOptions.workerSrc = `${assets}/pdf.worker.min.mjs`;
  const worker = await createWorker("eng", 1, {
    workerPath: `${assets}/worker.min.js`,
    corePath: `${assets}/tesseract-core-lstm.wasm.js`,
    langPath: new URL(assets, window.location.origin).href,
    workerBlobURL: false,
  });
  const pages: string[] = [];
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    for (const file of files) {
      const loading = getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
      try {
        const pdf = await loading.promise;
        if (pages.length + pdf.numPages > 100) throw new Error("Upload up to 100 invoice pages at a time.");
        for (let n = 1; n <= pdf.numPages; n++) {
          onProgress(`Reading ${file.name}, page ${n} of ${pdf.numPages}…`);
          const page = await pdf.getPage(n);
          const size = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(240 / 72, 2700 / Math.max(size.width, size.height)) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            await page.render({ canvas, viewport }).promise;
            const { data } = await worker.recognize(canvas);
            pages.push(data.text);
          } finally {
            canvas.width = canvas.height = 0;
            page.cleanup();
          }
        }
      } catch (error) {
        throw new Error(`${file.name}: ${(error as Error).message}`);
      } finally {
        await loading.destroy();
      }
    }
  } finally {
    await worker.terminate();
  }
  return pages;
}
