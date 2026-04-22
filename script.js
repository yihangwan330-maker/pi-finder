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

let constants = new Map();

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
    <span class="result-kicker">结果</span>
    <h2>${title}</h2>
    <p>${message}</p>
    ${contextHtml}
  `;
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

  return `你输入的是 ${query.length} 位数字串。若把小数展开看作随机数字流，它平均约 ${formatNumber(expected)} 位出现一次；当前搜索范围的理论命中概率约为 ${percent}。`;
}

function makeContextHtml(context) {
  if (!context) return "";

  const prefix = context.hasBefore ? "..." : "";
  const suffix = context.hasAfter ? "..." : "";
  return `
    <div class="context" aria-label="小数上下文">
      ${prefix}${escapeHtml(context.before)}<mark>${escapeHtml(context.match)}</mark>${escapeHtml(context.after)}${suffix}
    </div>
  `;
}

function updateEstimate() {
  const info = constants.get(constantSelect.value);
  const limit = Number(precisionSelect.value);

  if (!info) {
    estimateText.textContent = "-";
    return;
  }

  if (info.mode === "dataset") {
    const seconds = Math.max(0.4, limit / 25000000);
    estimateText.textContent = formatSeconds(seconds);
    return;
  }

  estimateText.textContent = "需要数据";
}

function updateStatus(message = "Ready", searchedDigits = 0) {
  const info = constants.get(constantSelect.value);
  statusText.textContent = message;
  digitCount.textContent = `${formatNumber(searchedDigits)} 位`;
  constantName.textContent = info?.label || constantSelect.value;
  updateEstimate();
}

function rebuildLimitOptions(info) {
  const current = Number(precisionSelect.value);
  const limits = [20000, 50000, 100000, 200000, 500000, 1000000, 10000000, 100000000]
    .filter((value) => value <= info.availableDigits);

  precisionSelect.innerHTML = limits
    .map((value) => `<option value="${value}">前 ${formatNumber(value)} 位</option>`)
    .join("");

  const best = limits.includes(current) ? current : limits[Math.min(1, limits.length - 1)];
  precisionSelect.value = String(best);
  updateEstimate();
}

async function loadConstants() {
  const response = await fetch("/api/constants");
  if (!response.ok) throw new Error("Failed to load constants");

  const payload = await response.json();
  constants = new Map(payload.constants.map((item) => [item.key, item]));

  constantSelect.innerHTML = payload.constants
    .map((item) => {
      const mode = item.mode === "dataset" ? "" : " · 未安装数据";
      return `<option value="${item.key}">${item.label} ${mode}</option>`;
    })
    .join("");

  constantSelect.value = "pi";
  rebuildLimitOptions(constants.get("pi"));
  updateStatus("Ready", 0);
}

async function runSearch(query, key, limit) {
  const startedAt = performance.now();
  const params = new URLSearchParams({ constant: key, query, limit: String(limit) });
  const response = await fetch(`/api/search?${params}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Search failed");
  }

  const elapsedSeconds = payload.elapsedMs ? payload.elapsedMs / 1000 : (performance.now() - startedAt) / 1000;
  updateStatus(`Done in ${formatSeconds(elapsedSeconds).replace("~", "")}`, payload.searchedDigits);

  const note = probabilityNote(query, payload.searchedDigits);
  const modeText = "数据集模式";

  if (!payload.found) {
    renderResult(
      "missing",
      "暂时没找到",
      `在 ${payload.constant.fullName} 的前 ${formatNumber(payload.searchedDigits)} 位小数中没有找到 ${escapeHtml(query)}。当前使用${modeText}。${note ? " " + note : ""}`
    );
    return;
  }

  renderResult(
    "found",
    `第 ${formatNumber(payload.start)} 位到第 ${formatNumber(payload.end)} 位`,
    `${escapeHtml(query)} 第一次出现在 ${payload.constant.fullName} 的这个位置。当前使用${modeText}。${note ? " " + note : ""}`,
    makeContextHtml(payload.context)
  );
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = cleanQuery(numberInput.value);
  numberInput.value = query;

  if (!query) {
    renderResult("error", "请输入数字", "可以输入生日、纪念日、手机号后几位，非数字字符会被自动忽略。");
    return;
  }

  const info = constants.get(constantSelect.value);
  if (!info || info.mode !== "dataset") {
    renderResult("error", "数据集未安装", "正式版需要先在服务器上安装对应常数的数据分块，例如 data/pi/manifest.json 和 chunk 文件。");
    return;
  }

  setBusy(true);
  updateStatus("Searching...", 0);

  try {
    await runSearch(query, constantSelect.value, Number(precisionSelect.value));
  } catch (error) {
    updateStatus("Error", 0);
    renderResult("error", "搜索失败", error.message || "后端没有完成这次查询。");
  } finally {
    setBusy(false);
  }
});

numberInput.addEventListener("input", () => {
  const cleaned = cleanQuery(numberInput.value);
  if (numberInput.value !== cleaned) numberInput.value = cleaned;
});

constantSelect.addEventListener("change", () => {
  rebuildLimitOptions(constants.get(constantSelect.value));
  updateStatus("Ready", 0);
});

precisionSelect.addEventListener("change", updateEstimate);

loadConstants().catch((error) => {
  renderResult(
    "error",
    "后端未连接",
    `${error.message}。请用 npm start 启动动态网站，然后访问 http://localhost:8000。`
  );
});

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
