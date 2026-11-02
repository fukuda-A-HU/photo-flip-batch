(() => {
  const PREVIEW_LIMIT = 240;

  const dropzone = document.getElementById("dropzone");
  const folderInput = document.getElementById("folder");
  const flipVInput = document.getElementById("flip-v");
  const flipHInput = document.getElementById("flip-h");
  const summary = document.getElementById("summary");
  const clearButton = document.getElementById("clear");
  const downloadButton = document.getElementById("download");
  const progress = document.getElementById("progress");
  const status = document.getElementById("status");
  const fallback = document.getElementById("fallback");
  const fallbackLink = document.getElementById("fallback-link");
  const grid = document.getElementById("grid");
  let resultUrl = "";

  const state = {
    items: [],
    skipped: 0,
    busy: false,
  };

  if (typeof JSZip === "undefined") {
    setStatus("ZIP ライブラリを読み込めませんでした。通信環境を確認して、ページを再読み込みしてください。", true);
    downloadButton.disabled = true;
    return;
  }

  dropzone.addEventListener("click", () => {
    if (!state.busy) folderInput.click();
  });

  dropzone.addEventListener("keydown", (event) => {
    if (state.busy) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      folderInput.click();
    }
  });

  folderInput.addEventListener("change", () => {
    const files = [...folderInput.files].map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));
    folderInput.value = "";
    adoptFiles(files);
  });

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!state.busy) dropzone.classList.add("dragover");
  });

  document.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) dropzone.classList.remove("dragover");
  });

  document.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    if (state.busy) return;
    readDrop(event.dataTransfer).then(adoptFiles).catch(() => {
      setStatus("フォルダを読み取れませんでした。", true);
    });
  });

  flipVInput.addEventListener("change", syncFlipPreview);
  flipHInput.addEventListener("change", syncFlipPreview);
  clearButton.addEventListener("click", () => adoptFiles([]));
  downloadButton.addEventListener("click", downloadZip);

  function flipSelected() {
    return flipVInput.checked || flipHInput.checked;
  }

  function syncFlipPreview() {
    grid.classList.toggle("flip-v", flipVInput.checked);
    grid.classList.toggle("flip-h", flipHInput.checked);
    refresh();
  }

  function refresh() {
    const count = state.items.length;
    clearButton.hidden = count === 0;
    if (count === 0) {
      summary.textContent = state.skipped
        ? "対応する画像が見つかりませんでした"
        : "画像がまだ選択されていません";
    } else {
      const extra = state.skipped ? `（画像以外 ${state.skipped} 件は除きました）` : "";
      summary.textContent = `${count} 枚を選択中${extra}`;
    }
    downloadButton.disabled = state.busy || count === 0 || !flipSelected();
    if (!state.busy) {
      if (count > 0 && !flipSelected()) {
        setStatus("上下反転・左右反転の少なくとも一方を選んでください。");
      } else {
        setStatus("");
      }
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    dropzone.setAttribute("aria-disabled", String(busy));
    flipVInput.disabled = busy;
    flipHInput.disabled = busy;
    clearButton.disabled = busy;
    downloadButton.disabled = busy || state.items.length === 0 || !flipSelected();
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
  }

  function detectType(file) {
    const type = (file.type || "").toLowerCase();
    if (type === "image/jpeg" || type === "image/png" || type === "image/webp" || type === "image/gif") {
      return type;
    }
    const name = file.name.toLowerCase();
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".webp")) return "image/webp";
    if (name.endsWith(".gif")) return "image/gif";
    return null;
  }

  function sanitizePath(path) {
    return String(path || "")
      .replaceAll("\\", "/")
      .split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");
  }

  function clearResultLink() {
    if (!resultUrl) return;
    URL.revokeObjectURL(resultUrl);
    resultUrl = "";
    fallbackLink.removeAttribute("href");
    fallback.hidden = true;
  }

  function adoptFiles(entries) {
    clearResultLink();
    for (const item of state.items) URL.revokeObjectURL(item.url);
    const items = [];
    let skipped = 0;
    for (const entry of entries) {
      const type = detectType(entry.file);
      const relativePath = sanitizePath(entry.relativePath || entry.file.name);
      if (!type || !relativePath || entry.file.size === 0) {
        skipped += 1;
        continue;
      }
      items.push({
        file: entry.file,
        relativePath,
        type,
        url: URL.createObjectURL(entry.file),
      });
    }
    state.items = items;
    state.skipped = skipped;
    renderPreviews();
    refresh();
  }

  function renderPreviews() {
    grid.replaceChildren();
    const visible = state.items.slice(0, PREVIEW_LIMIT);
    for (const item of visible) {
      const card = document.createElement("li");
      card.className = "card";
      const thumb = document.createElement("div");
      thumb.className = "thumb";
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.relativePath;
      thumb.append(img);
      const name = document.createElement("p");
      name.className = "name";
      name.textContent = item.relativePath;
      name.title = item.relativePath;
      card.append(thumb, name);
      grid.append(card);
    }
    if (state.items.length > visible.length) {
      const note = document.createElement("li");
      note.className = "card";
      note.textContent = `プレビューは先頭 ${PREVIEW_LIMIT} 枚です。ダウンロードには ${state.items.length} 枚すべてが含まれます。`;
      grid.append(note);
    }
  }

  async function readDrop(dataTransfer) {
    const items = [...(dataTransfer.items || [])].filter((item) => item.kind === "file");
    const entries = items
      .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (entries.length === 0) {
      return [...(dataTransfer.files || [])].map((file) => ({ file, relativePath: file.name }));
    }
    const collected = [];
    for (const entry of entries) {
      collected.push(...(await collectEntry(entry, "")));
    }
    return collected;
  }

  async function collectEntry(entry, parent) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return [{ file, relativePath: parent + entry.name }];
    }
    if (!entry.isDirectory) return [];
    const reader = entry.createReader();
    const children = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      children.push(...batch);
    }
    const nested = [];
    const prefix = parent + entry.name + "/";
    for (const child of children) {
      nested.push(...(await collectEntry(child, prefix)));
    }
    return nested;
  }

  function exportPlan(item) {
    const ext = extensionOf(item.relativePath);
    if (item.type === "image/gif") return { mime: "image/png", ext: "png", convertedFromGif: true };
    if (item.type === "image/jpeg") return { mime: "image/jpeg", ext: ext || "jpg", convertedFromGif: false };
    if (item.type === "image/webp") return { mime: "image/webp", ext: ext || "webp", convertedFromGif: false };
    return { mime: "image/png", ext: ext || "png", convertedFromGif: false };
  }

  function extensionOf(path) {
    const base = path.split("/").pop();
    const dot = base.lastIndexOf(".");
    if (dot <= 0) return "";
    return base.slice(dot + 1);
  }

  function outputPath(relativePath, ext) {
    const slash = relativePath.lastIndexOf("/");
    const dir = slash >= 0 ? relativePath.slice(0, slash + 1) : "";
    const base = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    return `${dir}${stem}_flip.${ext}`;
  }

  function uniquePath(path, used) {
    if (!used.has(path)) {
      used.add(path);
      return path;
    }
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";
    let index = 2;
    let candidate = `${dir}${stem}_${index}${ext}`;
    while (used.has(candidate)) {
      index += 1;
      candidate = `${dir}${stem}_${index}${ext}`;
    }
    used.add(candidate);
    return candidate;
  }

  function flipBitmap(bitmap, flipH, flipV) {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.translate(flipH ? canvas.width : 0, flipV ? canvas.height : 0);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  }

  function canvasToBlob(canvas, mime) {
    const quality = mime === "image/jpeg" || mime === "image/webp" ? 0.92 : undefined;
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mime, quality);
    });
  }

  async function downloadZip() {
    if (state.busy || state.items.length === 0 || !flipSelected()) return;
    const flipV = flipVInput.checked;
    const flipH = flipHInput.checked;
    const items = state.items.slice();
    clearResultLink();
    setBusy(true);
    progress.hidden = false;
    progress.max = items.length;
    progress.value = 0;

    const zip = new JSZip();
    const used = new Set();
    let done = 0;
    let failed = 0;
    let gifConverted = 0;
    let formatFallback = 0;

    try {
      for (const item of items) {
        setStatus(`処理中… ${done + 1} / ${items.length}`);
        try {
          const bitmap = await createImageBitmap(item.file);
          const canvas = flipBitmap(bitmap, flipH, flipV);
          bitmap.close();
          let plan = exportPlan(item);
          let blob = await canvasToBlob(canvas, plan.mime);
          if (!blob && plan.mime !== "image/png") {
            blob = await canvasToBlob(canvas, "image/png");
            plan = { mime: "image/png", ext: "png", convertedFromGif: plan.convertedFromGif };
            formatFallback += 1;
          }
          if (!blob) throw new Error("blob");
          if (plan.convertedFromGif) gifConverted += 1;
          const name = uniquePath(outputPath(item.relativePath, plan.ext), used);
          zip.file(name, blob, { compression: "STORE" });
        } catch {
          failed += 1;
        }
        done += 1;
        progress.value = done;
      }

      const saved = items.length - failed;
      if (saved === 0) {
        setStatus("画像を処理できませんでした。", true);
        return;
      }

      setStatus("ZIP を作成しています…");
      const archive = await zip.generateAsync({ type: "blob" });
      resultUrl = URL.createObjectURL(archive);
      fallbackLink.href = resultUrl;
      fallback.hidden = false;
      const link = document.createElement("a");
      link.href = resultUrl;
      link.download = "反転画像.zip";
      link.click();

      const notes = [`${saved} 枚を ZIP にまとめました。`];
      if (gifConverted) notes.push(`GIF ${gifConverted} 枚は PNG で保存しました。`);
      if (formatFallback) notes.push(`${formatFallback} 枚は PNG に切り替えて保存しました。`);
      if (failed) notes.push(`${failed} 枚は読み取れずスキップしました。`);
      setStatus(notes.join(""));
    } catch {
      setStatus("ZIP の作成に失敗しました。", true);
    } finally {
      progress.hidden = true;
      setBusy(false);
    }
  }
})();
