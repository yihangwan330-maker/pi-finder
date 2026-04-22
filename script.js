const form = document.querySelector("#searchForm");
const numberInput = document.querySelector("#numberInput");
const constantSelect = document.querySelector("#constantSelect");
const precisionSelect = document.querySelector("#precisionSelect");
const searchButton = document.querySelector("#searchButton");
const statusText = document.querySelector("#statusText");
const digitCount = document.querySelector("#digitCount");
const constantName = document.querySelector("#constantName");
const estimateText = document.querySelector("#estimateText");
const result = document.querySelector("#result");

const constants = {
  pi: { label: "\u03c0", fullName: "\u5706\u5468\u7387 \u03c0", estimateBase: 0.7 },
  e: { label: "e", fullName: "\u81ea\u7136\u5e38\u6570 e", estimateBase: 1.0 },
  sqrt2: { label: "\u221a2", fullName: "\u221a2", estimateBase: 0.2 },
  phi: { label: "\u03c6", fullName: "\u9ec4\u91d1\u6bd4\u4f8b \u03c6", estimateBase: 0.25 }
};

const cache = new Map();
const runtimeSamples = new Map();
let activeKey = "pi";
let pendingQuery = "";
let pendingLimit = 0;
let startedAt = 0;
let elapsedTimer = null;
let worker = null;

const workerSource = `
  function pow10(exp) {
    return 10n ** BigInt(exp);
  }

  function arctanInverse(inverseX, scale) {
    const x = BigInt(inverseX);
    const xSquared = x * x;
    let term = scale / x;
    let sum = term;
    let denominator = 1n;
    let subtract = true;

    while (term !== 0n) {
      term /= xSquared;
      denominator += 2n;
      const fraction = term / denominator;
      if (fraction === 0n) break;
      sum = subtract ? sum - fraction : sum + fraction;
      subtract = !subtract;
    }

    return sum;
  }

  function integerSqrt(value) {
    if (value < 2n) return value;
    let x0 = value;
    let x1 = (x0 + value / x0) >> 1n;
    while (x1 < x0) {
      x0 = x1;
      x1 = (x0 + value / x0) >> 1n;
    }
    return x0;
  }

  function computePi(decimals, guardDigits) {
    const scale = pow10(decimals + guardDigits);
    return 16n * arctanInverse(5, scale) - 4n * arctanInverse(239, scale);
  }

  function computeE(decimals, guardDigits) {
    const scale = pow10(decimals + guardDigits);
    let sum = scale;
    let term = scale;
    let denominator = 1n;

    while (term > 0n) {
      term /= denominator;
      sum += term;
      denominator += 1n;
    }

    return sum;
  }

  function computeSqrt(value, decimals, guardDigits) {
    const scale = pow10(decimals + guardDigits);
    return integerSqrt(BigInt(value) * scale * scale);
  }

  function computePhi(decimals, guardDigits) {
    const scale = pow10(decimals + guardDigits);
    const sqrt5 = integerSqrt(5n * scale * scale);
    return (sqrt5 + scale) / 2n;
  }

  self.onmessage = (event) => {
    const key = event.data.key;
    const decimals = Number(event.data.decimals);
    const guardDigits = 12;

    self.postMessage({ type: "status", message: "Calculating..." });

    let scaled;
    if (key === "pi") scaled = computePi(decimals, guardDigits);
    if (key === "e") scaled = computeE(decimals, guardDigits);
    if (key === "sqrt2") scaled = computeSqrt(2, decimals, guardDigits);
    if (key === "phi") scaled = computePhi(decimals, guardDigits);

    const trimmed = scaled / pow10(guardDigits);
    const raw = trimmed.toString().padStart(decimals + 1, "0");

    self.postMessage({
      type: "done",
      key,
      decimals,
      digits: raw.slice(1, decimals + 1)
    });
  };
`;

function createWorker() {
  const blob = new Blob([workerSource], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

function setBusy(isBusy) {
  searchButton.disabled = isBusy;
  constantSelect.disabled = isBusy;
  precisionSelect.disabled = isBusy;
  numberInput.disabled = isBusy;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  if (seconds < 1) return "< 1s";
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  return `~${Math.ceil(seconds / 60)}min`;
}

function cleanQuery(value) {
  return value.replace(/\D/g, "");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderResult(type, title, message, contextHtml = "") {
  result.className = `result ${type}`;
  result.innerHTML = `
    <span class="result-kicker">\u7ed3\u679c</span>
    <h2>${title}</h2>
    <p>${message}</p>
    ${contextHtml}
  `;
}

function getActiveRecord() {
  return cache.get(activeKey) || { digits: "", decimals: 0 };
}

function probabilityForRange(queryLength, decimals) {
  if (!queryLength) return 0;
  return 1 - Math.exp(-decimals / 10 ** queryLength);
}

function probabilityNote(query, decimals) {
  if (query.length < 6) return "";

  const expected = 10 ** query.length;
  const probability = probabilityForRange(query.length, decimals);
  const percent = probability < 0.001
    ? "<0.1%"
    : `${(probability * 100).toFixed(probability < 0.01 ? 2 : 1)}%`;

  return `\u4f60\u8f93\u5165\u7684\u662f ${query.length} \u4f4d\u6570\u5b57\u4e32\u3002\u82e5\u628a\u5c0f\u6570\u5c55\u5f00\u770b\u4f5c\u968f\u673a\u6570\u5b57\u6d41\uff0c\u5b83\u5e73\u5747\u7ea6 ${formatNumber(expected)} \u4f4d\u51fa\u73b0\u4e00\u6b21\uff1b\u5f53\u524d\u641c\u7d22\u8303\u56f4\u7684\u7406\u8bba\u547d\u4e2d\u6982\u7387\u7ea6\u4e3a ${percent}\u3002`;
}

function estimateSeconds(key, decimals) {
  const exact = runtimeSamples.get(`${key}:${decimals}`);
  if (exact) return exact;

  const scale = decimals / 50000;
  const exponent = key === "e" ? 1.85 : key === "pi" ? 1.72 : 1.32;
  return constants[key].estimateBase * Math.pow(scale, exponent);
}

function updateEstimate() {
  const seconds = estimateSeconds(constantSelect.value, Number(precisionSelect.value));
  estimateText.textContent = formatSeconds(seconds);
}

function updateStatus(message = "Ready") {
  const record = getActiveRecord();
  statusText.textContent = message;
  digitCount.textContent = `${formatNumber(record.decimals)} \u4f4d`;
  constantName.textContent = constants[activeKey].label;
  updateEstimate();
}

function startElapsedTimer() {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    const seconds = (performance.now() - startedAt) / 1000;
    statusText.textContent = `Working ${formatSeconds(seconds).replace("~", "")}`;
  }, 500);
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function makeContextHtml(digits, index, query) {
  const radius = 34;
  const start = Math.max(0, index - radius);
  const end = Math.min(digits.length, index + query.length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < digits.length ? "..." : "";
  const before = escapeHtml(digits.slice(start, index));
  const match = escapeHtml(digits.slice(index, index + query.length));
  const after = escapeHtml(digits.slice(index + query.length, end));

  return `
    <div class="context" aria-label="\u5c0f\u6570\u4e0a\u4e0b\u6587">
      0.${prefix}${before}<mark>${match}</mark>${after}${suffix}
    </div>
  `;
}

function searchDigits(key, query, limit) {
  const meta = constants[key];
  const record = cache.get(key);
  const digits = record.digits.slice(0, limit);
  const foundAt = digits.indexOf(query);
  const note = probabilityNote(query, limit);

  if (foundAt === -1) {
    renderResult(
      "missing",
      "\u6682\u65f6\u6ca1\u627e\u5230",
      `\u5728 ${meta.fullName} \u7684\u524d ${formatNumber(limit)} \u4f4d\u5c0f\u6570\u4e2d\u6ca1\u6709\u627e\u5230 ${escapeHtml(query)}\u3002${note ? " " + note : ""}`
    );
    return;
  }

  const start = foundAt + 1;
  const end = foundAt + query.length;
  renderResult(
    "found",
    `\u7b2c ${formatNumber(start)} \u4f4d\u5230\u7b2c ${formatNumber(end)} \u4f4d`,
    `${escapeHtml(query)} \u7b2c\u4e00\u6b21\u51fa\u73b0\u5728 ${meta.fullName} \u7684\u8fd9\u4e2a\u4f4d\u7f6e\u3002${note ? " " + note : ""}`,
    makeContextHtml(digits, foundAt, query)
  );
}

function ensureDigits(key, decimals, query) {
  activeKey = key;
  pendingQuery = query;
  pendingLimit = decimals;

  const existing = cache.get(key);
  if (existing && existing.decimals >= decimals) {
    updateStatus("Ready");
    searchDigits(key, query, decimals);
    return;
  }

  setBusy(true);
  updateStatus("Preparing...");
  startedAt = performance.now();
  startElapsedTimer();

  if (worker) worker.terminate();
  worker = createWorker();

  worker.onmessage = (event) => {
    const { type, message, key: readyKey, decimals: readyDecimals, digits } = event.data;

    if (type === "status") {
      statusText.textContent = message;
      return;
    }

    if (type === "done") {
      const seconds = (performance.now() - startedAt) / 1000;
      runtimeSamples.set(`${readyKey}:${readyDecimals}`, seconds);
      cache.set(readyKey, { digits, decimals: readyDecimals });
      activeKey = readyKey;
      stopElapsedTimer();
      setBusy(false);
      updateStatus(`Done in ${formatSeconds(seconds).replace("~", "")}`);
      searchDigits(readyKey, pendingQuery, pendingLimit);
    }
  };

  worker.onerror = () => {
    stopElapsedTimer();
    setBusy(false);
    updateStatus("Error");
    renderResult(
      "error",
      "\u8ba1\u7b97\u5931\u8d25",
      "\u6d4f\u89c8\u5668\u6ca1\u6709\u5b8c\u6210\u8fd9\u6b21\u8ba1\u7b97\u3002\u53ef\u4ee5\u5148\u9009\u62e9\u8f83\u5c0f\u7684\u641c\u7d22\u8303\u56f4\u518d\u8bd5\u3002"
    );
  };

  worker.postMessage({ key, decimals });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = cleanQuery(numberInput.value);
  numberInput.value = query;

  if (!query) {
    renderResult(
      "error",
      "\u8bf7\u8f93\u5165\u6570\u5b57",
      "\u53ef\u4ee5\u8f93\u5165\u751f\u65e5\u3001\u7eaa\u5ff5\u65e5\u3001\u624b\u673a\u53f7\u540e\u51e0\u4f4d\uff0c\u975e\u6570\u5b57\u5b57\u7b26\u4f1a\u88ab\u81ea\u52a8\u5ffd\u7565\u3002"
    );
    return;
  }

  ensureDigits(constantSelect.value, Number(precisionSelect.value), query);
});

numberInput.addEventListener("input", () => {
  const cleaned = cleanQuery(numberInput.value);
  if (numberInput.value !== cleaned) numberInput.value = cleaned;
});

constantSelect.addEventListener("change", () => {
  activeKey = constantSelect.value;
  updateStatus("Ready");
});

precisionSelect.addEventListener("change", updateEstimate);
updateStatus("Ready");

const canvas = document.querySelector("#field");
const ctx = canvas.getContext("2d");
const particles = [];
let width = 0;
let height = 0;
let pixelRatio = 1;

function resetCanvas() {
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  particles.length = 0;
  const count = Math.min(150, Math.max(70, Math.floor((width * height) / 11000)));
  for (let i = 0; i < count; i += 1) {
    const angle = i * 2.399963 + Math.random() * 0.22;
    const radius = 20 + Math.sqrt(i) * 23;
    particles.push({
      angle,
      radius,
      speed: 0.0016 + Math.random() * 0.0018,
      size: 1 + Math.random() * 2.6,
      digit: String(Math.floor(Math.random() * 10)),
      hue: Math.random() > 0.52 ? "158, 222, 230" : "228, 207, 146"
    });
  }
}

function drawField() {
  ctx.clearRect(0, 0, width, height);
  const centerX = width * 0.66;
  const centerY = height * 0.42;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.font = "600 14px Consolas, monospace";

  for (const particle of particles) {
    particle.angle += particle.speed;
    const pulse = Math.sin(particle.angle * 2.7) * 12;
    const x = centerX + Math.cos(particle.angle) * (particle.radius + pulse);
    const y = centerY + Math.sin(particle.angle) * (particle.radius * 0.62 + pulse);
    const alpha = Math.max(0.12, 1 - particle.radius / 360);

    ctx.fillStyle = `rgba(${particle.hue}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, particle.size, 0, Math.PI * 2);
    ctx.fill();

    if (particle.size > 2.15) {
      ctx.fillStyle = `rgba(245, 247, 251, ${alpha * 0.42})`;
      ctx.fillText(particle.digit, x + 8, y + 4);
    }
  }

  ctx.restore();
  requestAnimationFrame(drawField);
}

window.addEventListener("resize", resetCanvas);
resetCanvas();
drawField();
