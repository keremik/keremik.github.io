/* Best Home – Belege direkt auf dem Gerät lesen (Texterkennung mit Tesseract, kostenlos, kein fremder Dienst).
   Die Bibliothek (ca. 5 MB) wird erst beim ersten Auslesen geladen. window.BH_OCR.text(blob) -> erkannter Text. */
(function () {
  "use strict";
  const ORDNER = new URL("vendor/ocr/", document.baseURI).href;
  let laden = null, arbeiter = null;
  function bibliothek() {
    if (!laden) {
      laden = new Promise((ok, fehler) => {
        const s = document.createElement("script");
        s.src = `${ORDNER}tesseract.min.js`;
        s.onload = () => ok(window.Tesseract);
        s.onerror = () => { laden = null; fehler(new Error("Texterkennung konnte nicht geladen werden")); };
        document.head.appendChild(s);
      });
    }
    return laden;
  }
  async function text(blob) {
    const T = await bibliothek();
    if (!arbeiter) {
      arbeiter = T.createWorker("deu", 1, { workerPath: `${ORDNER}worker.min.js`, corePath: ORDNER, langPath: ORDNER, gzip: true, workerBlobURL: false })
        .catch((e) => { arbeiter = null; throw e; });
    }
    const w = await arbeiter;
    const { data } = await w.recognize(blob);
    return String((data && data.text) || "");
  }
  window.BH_OCR = Object.freeze({ text });
})();
