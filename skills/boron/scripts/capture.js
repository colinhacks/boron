/**
 * Run inside an open boron.sh page. Resolves to `{ dataUrl, link }`: the exported
 * image as a `data:` URL, made by the app's own exporter rather than a screenshot
 * of the editor, and a link to the picture as it was exported.
 *
 * The file is one function expression, so a tool that evaluates a string can
 * call it as `(<this file>)({ format: "png", language: "typescript" })`.
 *
 * - `format`: png, svg, jpeg or webp. Default png.
 * - `language`: typescript, javascript, python, rust, go, json, bash, yaml or
 *   sql. Colors the document with the app's highlighter. A link's content is
 *   taken literally, so without this, code arrives uncolored.
 *
 * It clicks the real "Save" button, catches the Blob on its way to a download
 * link, and stops the download itself, so no browser download settings matter.
 */
async ({ format = "png", language } = {}) => {
  const LABELS = { png: "PNG", svg: "SVG", jpeg: "JPEG", webp: "WebP" };
  const label = LABELS[format];
  if (!label) throw new Error(`Unknown format "${format}", expected one of ${Object.keys(LABELS).join(", ")}`);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const saveButton = () =>
    [...document.querySelectorAll("button.split-button__action")].find((button) =>
      button.textContent.trim().startsWith("Save "),
    );

  /** The button stays disabled until the fonts are loaded and the block is laid out. */
  const deadline = Date.now() + 20_000;
  while (!saveButton() || saveButton().disabled) {
    if (Date.now() > deadline) throw new Error("Save button not ready after 20s");
    await sleep(100);
  }
  await document.fonts.ready;

  const initialHref = location.href;

  if (language) {
    const select = document.querySelector('select[aria-label="Syntax highlighting"]');
    if (!select) throw new Error("Syntax control not found");
    if (![...select.options].some((option) => option.value === language)) {
      throw new Error(`Unknown language "${language}", expected one of ${[...select.options].map((o) => o.value).join(", ")}`);
    }
    /**
     * React tracks a select's value itself, so the value is set through the
     * native setter for the change event to register. Picking a language only
     * re-colors when the value changes, so a link that already names it goes
     * through `auto` first.
     */
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    for (const value of ["auto", language]) {
      setValue.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(50);
    }
    /** The address bar is rewritten after a short pause and then carries the colors. */
    const linkDeadline = Date.now() + 3_000;
    while (location.href === initialHref && Date.now() < linkDeadline) await sleep(100);
  }

  if (saveButton().textContent.trim() !== `Save ${label}`) {
    saveButton().parentElement.querySelector("button.split-button__toggle").click();
    await sleep(50);
    const item = [...document.querySelectorAll(".split-menu__item")].find((candidate) =>
      candidate.textContent.trim().endsWith(`Save as ${label}`),
    );
    if (!item) throw new Error(`Menu item "Save as ${label}" not found`);
    item.click();
    while (saveButton().textContent.trim() !== `Save ${label}`) await sleep(50);
  }

  const createObjectURL = URL.createObjectURL;
  const anchorClick = HTMLAnchorElement.prototype.click;
  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error("No image was exported after 20s")), 20_000);
      URL.createObjectURL = (object) => {
        if (object instanceof Blob) resolve(object);
        return createObjectURL.call(URL, object);
      };
      HTMLAnchorElement.prototype.click = function () {};
      saveButton().click();
    });
  } finally {
    URL.createObjectURL = createObjectURL;
    HTMLAnchorElement.prototype.click = anchorClick;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  /** A document too long for the address bar leaves it bare; the opened link still describes the picture then. */
  const link = new URL(location.href).searchParams.has("content") ? location.href : initialHref;
  return { dataUrl, link };
}
