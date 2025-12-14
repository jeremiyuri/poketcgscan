const video = document.getElementById("video");
const btnStart = document.getElementById("btnStart");
const btnSnap = document.getElementById("btnSnap");
const fileInput = document.getElementById("file");

const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const progEl = document.getElementById("prog");

const editor = document.getElementById("editor");
const stage = document.getElementById("stage");
const photo = document.getElementById("photo");
const hiddenWork = document.getElementById("hiddenWork");

const cropBox = document.getElementById("cropBox");
const handles = document.getElementById("handles");

const btnPresetName = document.getElementById("btnPresetName");
const btnPresetCode = document.getElementById("btnPresetCode");
const btnOCR = document.getElementById("btnOCR");
const btnSearch = document.getElementById("btnSearch");

const ocrText = document.getElementById("ocrText");
const codeBox = document.getElementById("codeBox");
const resultEl = document.getElementById("result");

let stream = null;

// Estado del recorte (en pixeles del canvas interno)
let crop = { x: 40, y: 40, w: 280, h: 120 };
let dragging = null; // "move" o handle "tl/tr/bl/br"
let startPt = null;
let startCrop = null;

// helpers UI
function setStatus(t){ statusEl.textContent = t; }
function setLog(t){ logEl.textContent = t || ""; }
function setProg(p){ progEl.style.width = `${Math.max(0, Math.min(100, p))}%`; }

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// convierte coords de pantalla (stage) a coords canvas
function stageToCanvas(pt){
  const rect = stage.getBoundingClientRect();
  const x = (pt.x - rect.left) / rect.width;
  const y = (pt.y - rect.top) / rect.height;
  return { x: x * photo.width, y: y * photo.height };
}

function updateCropUI(){
  // cropBox se posiciona con % relativo al stage
  const rect = stage.getBoundingClientRect();
  const sx = (crop.x / photo.width) * rect.width;
  const sy = (crop.y / photo.height) * rect.height;
  const sw = (crop.w / photo.width) * rect.width;
  const sh = (crop.h / photo.height) * rect.height;

  cropBox.style.left = `${sx}px`;
  cropBox.style.top = `${sy}px`;
  cropBox.style.width = `${sw}px`;
  cropBox.style.height = `${sh}px`;

  // handles se pegan al cropBox
  handles.style.left = `${sx}px`;
  handles.style.top = `${sy}px`;
  handles.style.width = `${sw}px`;
  handles.style.height = `${sh}px`;
}

function setPresetName(){
  // franja superior izquierda (evita HP)
  crop.x = Math.round(photo.width * 0.06);
  crop.y = Math.round(photo.height * 0.03);
  crop.w = Math.round(photo.width * 0.62);
  crop.h = Math.round(photo.height * 0.16);
  updateCropUI();
}

function setPresetCode(){
  // franja inferior izquierda (código)
  crop.x = Math.round(photo.width * 0.02);
  crop.y = Math.round(photo.height * 0.78);
  crop.w = Math.round(photo.width * 0.65);
  crop.h = Math.round(photo.height * 0.20);
  updateCropUI();
}

function cleanOCR(text){
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w\/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSetAndNumber(text){
  const t = cleanOCR(text).toUpperCase();
  // AAA 123/456
  const m = t.match(/\b([A-Z]{2,4})\s+(\d{1,3})\s*\/\s*(\d{2,4})\b/);
  if (m) return { ptcgoCode: m[1], number: m[2], denom: m[3] };
  // AAA123/456
  const m2 = t.match(/\b([A-Z]{2,4})(\d{1,3})\s*\/\s*(\d{2,4})\b/);
  if (m2) return { ptcgoCode: m2[1], number: m2[2], denom: m2[3] };
  return null;
}

async function searchByCode(ptcgoCode, number){
  const q = `set.ptcgoCode:${ptcgoCode} number:${number}`;
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=6`;
  const res = await fetch(url);
  return res.json();
}

async function searchByName(name){
  const q = `name:${name}*`;
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=6`;
  const res = await fetch(url);
  return res.json();
}

// Cámara
btnStart.onclick = async () => {
  try {
    setStatus("Pidiendo permisos…");
    setLog("");
    setProg(0);

    if (stream){
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    video.srcObject = stream;
    await video.play();

    btnSnap.disabled = false;
    setStatus("Cámara OK ✅");
  } catch (e){
    console.error(e);
    setStatus("Error ❌");
    setLog("No se pudo acceder a la cámara. Abre en Chrome/Safari y permite cámara.");
  }
};

btnSnap.onclick = async () => {
  try {
    // snapshot a canvas
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    // escalamos un poco para OCR (más grande = mejor, pero sin exagerar)
    const scale = 1.0;
    photo.width = Math.round(w * scale);
    photo.height = Math.round(h * scale);

    const ctx = photo.getContext("2d");
    ctx.drawImage(video, 0, 0, photo.width, photo.height);

    editor.classList.remove("hidden");
    ocrText.value = "";
    codeBox.value = "";
    btnSearch.disabled = true;
    resultEl.textContent = "Foto lista. Mueve el recorte y pulsa OCR.";

    // preset por defecto: código
    setPresetCode();
  } catch (e){
    console.error(e);
  }
};

// Subir foto
fileInput.onchange = async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    // Ajuste: hacemos que el canvas tenga un ancho razonable
    const maxW = 1400;
    const ratio = img.width > maxW ? (maxW / img.width) : 1;
    photo.width = Math.round(img.width * ratio);
    photo.height = Math.round(img.height * ratio);

    const ctx = photo.getContext("2d");
    ctx.drawImage(img, 0, 0, photo.width, photo.height);

    editor.classList.remove("hidden");
    ocrText.value = "";
    codeBox.value = "";
    btnSearch.disabled = true;
    resultEl.textContent = "Imagen lista. Mueve el recorte y pulsa OCR.";

    setPresetCode();
  };
  img.src = URL.createObjectURL(file);
};

// Presets
btnPresetName.onclick = setPresetName;
btnPresetCode.onclick = setPresetCode;

// Drag & resize del recorte (Pointer Events)
function onPointerDown(e){
  e.preventDefault();
  const target = e.target;

  startPt = stageToCanvas({ x: e.clientX, y: e.clientY });
  startCrop = { ...crop };

  if (target.classList.contains("h")) {
    dragging = target.dataset.handle; // tl,tr,bl,br
  } else {
    dragging = "move";
  }

  cropBox.setPointerCapture(e.pointerId);
}
function onPointerMove(e){
  if (!dragging) return;
  const p = stageToCanvas({ x: e.clientX, y: e.clientY });
  const dx = p.x - startPt.x;
  const dy = p.y - startPt.y;

  const minSize = 60;

  if (dragging === "move") {
    crop.x = clamp(startCrop.x + dx, 0, photo.width - startCrop.w);
    crop.y = clamp(startCrop.y + dy, 0, photo.height - startCrop.h);
  } else {
    // resize desde esquina
    let x = startCrop.x, y = startCrop.y, w = startCrop.w, h = startCrop.h;

    if (dragging.includes("t")) { y = startCrop.y + dy; h = startCrop.h - dy; }
    if (dragging.includes("b")) { h = startCrop.h + dy; }
    if (dragging.includes("l")) { x = startCrop.x + dx; w = startCrop.w - dx; }
    if (dragging.includes("r")) { w = startCrop.w + dx; }

    // clamp tamaño
    w = Math.max(minSize, w);
    h = Math.max(minSize, h);

    // clamp posición
    x = clamp(x, 0, photo.width - w);
    y = clamp(y, 0, photo.height - h);

    crop = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  updateCropUI();
}
function onPointerUp(){
  dragging = null;
  startPt = null;
  startCrop = null;
}

cropBox.addEventListener("pointerdown", onPointerDown);
handles.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

// OCR del recorte
btnOCR.onclick = async () => {
  try {
    setStatus("OCR…");
    setLog("");
    setProg(0);
    btnOCR.disabled = true;
    btnSearch.disabled = true;

    // copio el recorte al hiddenWork
    hiddenWork.width = crop.w;
    hiddenWork.height = crop.h;

    const wctx = hiddenWork.getContext("2d", { willReadFrequently: true });
    wctx.drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    // preproceso B/N + contraste
    const imgData = wctx.getImageData(0, 0, crop.w, crop.h);
    const d = imgData.data;
    const threshold = 165;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      let v = (0.299*r + 0.587*g + 0.114*b);
      v = (v - 128) * 1.4 + 128;
      const bw = v > threshold ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = bw;
    }
    wctx.putImageData(imgData, 0, 0);

    const { data } = await Tesseract.recognize(hiddenWork, "eng", {
      logger: m => {
        if (m.status === "recognizing text") setProg(Math.round((m.progress || 0) * 100));
        setLog(`${m.status}${m.progress != null ? " " + Math.round(m.progress*100) + "%" : ""}`);
      },
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
    });

    const raw = (data.text || "").replace(/\n/g, " ").trim();
    const cleaned = cleanOCR(raw);

    ocrText.value = cleaned;

    // intenta extraer código automáticamente
    const parsed = extractSetAndNumber(cleaned);
    if (parsed) {
      codeBox.value = `${parsed.ptcgoCode} ${parsed.number}/${parsed.denom}`;
      btnSearch.disabled = false;
      resultEl.innerHTML = `<span class="pill">Código:</span> <b>${codeBox.value}</b>`;
      setStatus("OK ✅");
    } else {
      // si no hay código, deja el texto para buscar por nombre manual
      btnSearch.disabled = cleaned.length < 3;
      resultEl.innerHTML = `<div class="muted">OCR listo. Si no salió el código, prueba el preset “Código” y ajusta el recorte. También puedes escribir el nombre manual y buscar.</div>`;
      setStatus("OK ✅");
    }

    setProg(100);
  } catch (e){
    console.error(e);
    setStatus("Error ❌");
    setLog("OCR falló. Prueba con menos reflejo, y que el texto quede nítido.");
  } finally {
    btnOCR.disabled = false;
  }
};

// Buscar carta (por código si existe, si no por nombre)
btnSearch.onclick = async () => {
  try {
    setStatus("Buscando…");
    btnSearch.disabled = true;
    resultEl.textContent = "Buscando…";

    const code = (codeBox.value || "").trim();
    const parsed = extractSetAndNumber(code);

    let cards = [];
    if (parsed) {
      const json = await searchByCode(parsed.ptcgoCode, parsed.number);
      cards = json?.data || [];
    } else {
      // fallback: usar OCR como nombre (o lo que el usuario escribió en codeBox)
      const name = (code || ocrText.value || "").trim();
      if (!name) {
        resultEl.textContent = "Escribe un nombre o un código.";
        setStatus("Listo");
        return;
      }
      const json = await searchByName(name);
      cards = json?.data || [];
    }

    if (!cards.length) {
      resultEl.innerHTML = `<div class="muted">No encontré resultados. Prueba mover el recorte y repetir OCR, o corrige el texto a mano.</div>`;
      setStatus("Sin match 😅");
      return;
    }

    setStatus("Listo ✅");

    const items = cards.slice(0,6).map(c => {
      const img = c?.images?.small || c?.images?.large || "";
      const setName = c?.set?.name || "";
      const number = c?.number || "";
      const rarity = c?.rarity || "";
      const name = c?.name || "";
      return `
        <div style="margin-top:12px;">
          ${img ? `<img src="${img}" alt="${name}" style="width:100%;border-radius:14px;">` : ""}
          <div style="margin-top:8px;"><b>${name}</b> <span class="muted">(${setName} #${number})</span></div>
          <div class="muted">${rarity ? "⭐ " + rarity : ""}</div>
        </div>
      `;
    }).join("");

    resultEl.innerHTML = `<div class="pill">Resultados:</div>${items}`;
  } catch (e){
    console.error(e);
    setStatus("Error ❌");
    resultEl.textContent = "Error al buscar.";
  } finally {
    btnSearch.disabled = false;
  }
};

// Reposicionar UI cuando cambie tamaño
window.addEventListener("resize", () => {
  if (!editor.classList.contains("hidden")) updateCropUI();
});

// Al abrir el editor por primera vez (foto/carga), updateCropUI se llama desde preset
