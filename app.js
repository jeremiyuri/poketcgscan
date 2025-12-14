const video = document.getElementById("video");
const frame = document.getElementById("frame");
const crop = document.getElementById("crop");

const btnStart = document.getElementById("btnStart");
const btnScan = document.getElementById("btnScan");
const btnSearch = document.getElementById("btnSearch");
const btnToggleCrop = document.getElementById("btnToggleCrop");

const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const progEl = document.getElementById("prog");
const rawBox = document.getElementById("rawBox");
const codeBox = document.getElementById("codeBox");
const resultEl = document.getElementById("result");

let stream = null;
let showCrop = false;

function setStatus(t){ statusEl.textContent = t; }
function setLog(t){ logEl.textContent = t || ""; }
function setProg(p){ progEl.style.width = `${Math.max(0, Math.min(100, p))}%`; }

btnToggleCrop.onclick = () => {
  showCrop = !showCrop;
  crop.classList.toggle("hidden", !showCrop);
  btnToggleCrop.textContent = showCrop ? "Ocultar recorte" : "Ver recorte";
};

function cleanOCR(text){
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w\/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extrae algo tipo: DRI 104/182, LOR 123/196, etc.
function extractSetAndNumber(text){
  const t = cleanOCR(text).toUpperCase();

  // patrón principal: AAA 123/456
  const m = t.match(/\b([A-Z]{2,4})\s+(\d{1,3})\s*\/\s*(\d{2,4})\b/);
  if (m) return { ptcgoCode: m[1], number: m[2], denom: m[3] };

  // fallback: AAA123/456 (pegado)
  const m2 = t.match(/\b([A-Z]{2,4})(\d{1,3})\s*\/\s*(\d{2,4})\b/);
  if (m2) return { ptcgoCode: m2[1], number: m2[2], denom: m2[3] };

  return null;
}

async function searchByCode(ptcgoCode, number){
  // Pokémon TCG API v2: buscar por set.ptcgoCode + number
  // Ej: set.ptcgoCode:DRI number:104
  const q = `set.ptcgoCode:${ptcgoCode} number:${number}`;
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=6`;
  const res = await fetch(url);
  return res.json();
}

btnStart.onclick = async () => {
  try {
    setStatus("Pidiendo permisos…");
    setLog("");
    setProg(0);

    if (stream){
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }

    // Más compatible: primero intenta trasera simple, si falla: cualquiera
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    video.srcObject = stream;
    await video.play();

    btnScan.disabled = false;
    btnToggleCrop.disabled = false;
    setStatus("Cámara OK ✅");
  } catch (e){
    console.error(e);
    setStatus("Error ❌");
    setLog("No se pudo acceder a la cámara. Ábrelo en Chrome/Safari (no navegador interno) y permite cámara.");
  }
};

btnScan.onclick = async () => {
  try {
    btnScan.disabled = true;
    btnSearch.disabled = true;
    rawBox.value = "";
    codeBox.value = "";
    resultEl.textContent = "Escaneando el código inferior…";
    setStatus("Capturando…");
    setProg(0);

    const w = video.videoWidth;
    const h = video.videoHeight;

    frame.width = w; frame.height = h;
    const fctx = frame.getContext("2d", { willReadFrequently: true });
    fctx.drawImage(video, 0, 0, w, h);

    // ✅ RECORTE: franja inferior izquierda (donde suele estar el código)
    // Ajustes base:
    const cropX = Math.round(w * 0.02);
    const cropY = Math.round(h * 0.78);
    const cropW = Math.round(w * 0.60);
    const cropH = Math.round(h * 0.20);

    crop.width = cropW;
    crop.height = cropH;
    const cctx = crop.getContext("2d", { willReadFrequently: true });
    cctx.drawImage(frame, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // ✅ Preproceso B/N
    const imgData = cctx.getImageData(0, 0, cropW, cropH);
    const d = imgData.data;
    const threshold = 160;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      let v = (0.299*r + 0.587*g + 0.114*b);
      v = (v - 128) * 1.4 + 128;
      const bw = v > threshold ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = bw;
    }
    cctx.putImageData(imgData, 0, 0);

    setStatus("OCR…");

    const { data } = await Tesseract.recognize(crop, "eng", {
      logger: m => {
        if (m.status === "recognizing text") setProg(Math.round((m.progress || 0) * 100));
        setLog(`${m.status}${m.progress != null ? " " + Math.round(m.progress*100) + "%" : ""}`);
      },
      // single block suele ir bien para el texto inferior
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
    });

    const raw = (data.text || "").replace(/\n/g, " ").trim();
    rawBox.value = cleanOCR(raw);

    const parsed = extractSetAndNumber(raw);
    if (parsed){
      codeBox.value = `${parsed.ptcgoCode} ${parsed.number}/${parsed.denom}`;
      btnSearch.disabled = false;
      setStatus("Código detectado ✅");
      resultEl.innerHTML = `<span class="pill">Detectado:</span> <b>${codeBox.value}</b><div class="muted" style="margin-top:8px;">Pulsa “Buscar por código”.</div>`;
    } else {
      setStatus("No se encontró código ⚠️");
      resultEl.innerHTML = `<div class="muted">No pude extraer un patrón tipo <b>DRI 104/182</b>. Activa “Ver recorte” y asegúrate de que el código entre en el recorte.</div>`;
    }

    setProg(100);
  } catch (e){
    console.error(e);
    setStatus("Error ❌");
    setLog("Falló el OCR. Prueba con más luz y menos reflejo.");
  } finally {
    btnScan.disabled = false;
  }
};

btnSearch.onclick = async () => {
  const text = (codeBox.value || "").toUpperCase().trim();
  const parsed = extractSetAndNumber(text);

  if (!parsed) {
    resultEl.innerHTML = `<div class="muted">Escribe algo como <b>DRI 104/182</b> en “Código encontrado”.</div>`;
    return;
  }

  try {
    btnSearch.disabled = true;
    setStatus("Buscando…");
    resultEl.textContent = "Buscando en Pokémon TCG API…";

    const json = await searchByCode(parsed.ptcgoCode, parsed.number);
    const cards = json?.data || [];

    if (!cards.length){
      setStatus("Sin match 😅");
      resultEl.innerHTML = `<div class="muted">No encontré carta para <b>${parsed.ptcgoCode} ${parsed.number}/${parsed.denom}</b>. (A veces el set code cambia; podemos ajustar el parser.)</div>`;
      return;
    }

    setStatus("Listo ✅");

    const items = cards.map(c => {
      const img = c?.images?.small || c?.images?.large || "";
      const setName = c?.set?.name || "";
      const number = c?.number || "";
      const rarity = c?.rarity || "";
      const name = c?.name || "";
      return `
        <div style="margin-top:12px;">
          ${img ? `<img src="${img}" alt="${name}">` : ""}
          <div style="margin-top:8px;"><b>${name}</b> <span class="muted">(${setName} #${number})</span></div>
          <div class="muted">${rarity ? "⭐ " + rarity : ""}</div>
        </div>
      `;
    }).join("");

    resultEl.innerHTML = `<div class="pill">Resultados:</div>${items}`;
  } catch (e){
    console.error(e);
    setStatus("Error ❌");
    resultEl.textContent = "Error consultando la API.";
  } finally {
    btnSearch.disabled = false;
  }
};
