const { useState, useEffect, useRef, useCallback } = React;

/* ------------------------------------------------------------------ */
/* Backend: Google Apps Script Web App (guarda todo en el Google Sheet)*/
/* Usamos JSONP (carga vía <script>) en vez de fetch() porque Apps      */
/* Script no soporta configurar CORS, y fetch() cross-origin lo bloquea.*/
/* ------------------------------------------------------------------ */
const API_URL = "https://script.google.com/macros/s/AKfycbziPh3NfDuuRFziySIF4dsji24_fhh4MHKePGPSmfGTyad9mkDLUwcIonGkkwsGPIkY1Q/exec";

function jsonp(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    const cleanup = () => {
      delete window[cbName];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP: tiempo de espera agotado"));
    }, timeoutMs);

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP: error al cargar"));
    };
    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;
    document.body.appendChild(script);
  });
}

async function apiGet() {
  return jsonp(API_URL + "?action=all");
}

async function apiPost(payload) {
  const params = new URLSearchParams();
  params.set("action", payload.action);
  if (payload.tx) params.set("tx", JSON.stringify(payload.tx));
  if (payload.id != null) params.set("id", payload.id);
  if (payload.monthKey) params.set("monthKey", payload.monthKey);
  if (payload.amount != null) params.set("amount", payload.amount);
  if (payload.mv) params.set("mv", JSON.stringify(payload.mv));
  if (payload.key != null) params.set("key", payload.key);
  if (payload.value != null) params.set("value", payload.value);
  return jsonp(API_URL + "?" + params.toString());
}

/* ------------------------------------------------------------------ */
/* Configuración de categorías                                        */
/* ------------------------------------------------------------------ */

const LOAN_MONTHLY_AMOUNT = 1315.1;

function buildLoanInstallments() {
  const out = [];
  let d = new Date(2026, 8, 1); // septiembre 2026 (mes 8 = índice 0-based)
  for (let i = 0; i < 12; i++) {
    const raw = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    out.push({
      key: `cuota-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label,
      fixedAmount: LOAN_MONTHLY_AMOUNT,
    });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
}

const CATS = [
  {
    key: "supermercado", label: "Víveres", emoji: "🛒",
    color: "#10b981", light: "#d1fae5", dark: "#065f46",
    subs: [
      { key: "supermercado", label: "Supermercado" },
      { key: "restaurante", label: "Restaurante" },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
  {
    key: "alquiler", label: "Gastos fijos", emoji: "🏠🚆",
    color: "#0ea5e9", light: "#e0f2fe", dark: "#075985",
    subs: [
      { key: "alquiler", label: "Alquiler" },
      { key: "electricidad", label: "Electricidad" },
      { key: "internet", label: "Internet (Sunrise)" },
      { key: "seguro_casa", label: "Seguro de casa" },
      { key: "suscripciones", label: "Suscripciones" },
      { key: "transporte", label: "Transporte" },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
  {
    key: "salud", label: "Salud", emoji: "🌿",
    color: "#ffffff", light: "#f0fdf4", dark: "#166534",
    subs: [
      { key: "farmacia", label: "Farmacia" },
      { key: "seguro_salud", label: "Seguro de salud" },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
  {
    key: "devolucion", label: "Devolución préstamo", emoji: "💸",
    color: "#f59e0b", light: "#fef3c7", dark: "#92400e",
    subs: buildLoanInstallments(),
  },
  {
    key: "casa", label: "Casa", emoji: "🛋️",
    color: "#8b5cf6", light: "#ede9fe", dark: "#5b21b6",
    subs: null, conceptPlaceholder: "Ej: mueble, arreglo, decoración",
  },
  {
    key: "ropa", label: "Ropa", emoji: "👗",
    color: "#d946ef", light: "#fae8ff", dark: "#86198f",
    subs: null, conceptPlaceholder: "Ej: zapatillas, campera, ropa interior",
  },
  {
    key: "varios", label: "Varios", emoji: "🔀",
    color: "#64748b", light: "#f1f5f9", dark: "#1e293b",
    subs: null,
  },
  {
    key: "ahorro", label: "Ahorro", emoji: "🐷",
    color: "#16a34a", light: "#dcfce7", dark: "#14532d",
    subs: null,
  },
  {
    key: "viajes", label: "Viajes", emoji: "✈️",
    color: "#06b6d4", light: "#cffafe", dark: "#155e75",
    subs: [
      {
        key: "grecia", label: "Grecia", emoji: "🇬🇷",
        subs: [
          { key: "pasajes", label: "Pasajes" },
          { key: "hospedaje", label: "Hospedaje" },
          { key: "comida", label: "Comida" },
          { key: "compritas", label: "Compritas" },
        ],
      },
      {
        key: "marruecos", label: "Marruecos", emoji: "🇲🇦",
        subs: [
          { key: "pasajes", label: "Pasajes" },
          { key: "hospedaje", label: "Hospedaje" },
          { key: "comida", label: "Comida" },
          { key: "compritas", label: "Compritas" },
        ],
      },
    ],
  },
];

const CAT_BY_KEY = Object.fromEntries(CATS.map((c) => [c.key, c]));
const CURRENCY = "CHF";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function formatDateShort(d) {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" }) + ", " +
    d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
function monthLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}
function fmt(n) {
  return `${CURRENCY} ${Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function getLocation(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

// Calcula en qué mes impacta realmente una compra según el método de pago.
// No-crédito: impacta el mismo mes de la compra.
// Crédito: si el día de compra es <= día de cierre, cae en el resumen que
// cierra este mes y se paga el mes que viene; si es posterior, cae en el
// resumen siguiente y se paga dos meses después.
function computeChargeMonth(date, paymentMethod, cierreDay) {
  if (paymentMethod !== "credito") return monthKey(date);
  const shift = date.getDate() <= cierreDay ? 1 : 2;
  const d2 = new Date(date.getFullYear(), date.getMonth() + shift, 1);
  return monthKey(d2);
}

/* ------------------------------------------------------------------ */
/* Almacenamiento compartido (Google Sheet vía Apps Script)            */
/* ------------------------------------------------------------------ */

function useSharedData() {
  const DEFAULT_CONFIG = { cierreDay: 15, lastPaymentMethod: "no_credito" };
  const [data, setData] = useState({ transactions: [], income: {}, savings: [], config: DEFAULT_CONFIG });
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const fresh = await apiGet();
      setData({
        transactions: fresh.transactions || [],
        income: fresh.income || {},
        savings: fresh.savings || [],
        config: { ...DEFAULT_CONFIG, ...(fresh.config || {}) },
      });
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const mutate = useCallback((payload) => {
    apiPost(payload)
      .then((fresh) => {
        setData({
          transactions: fresh.transactions || [],
          income: fresh.income || {},
          savings: fresh.savings || [],
          config: { ...DEFAULT_CONFIG, ...(fresh.config || {}) },
        });
        setSaveError(false);
      })
      .catch(() => setSaveError(true));
  }, []);

  const addTransaction = useCallback((tx) => {
    setData((prev) => ({
      ...prev,
      transactions: [tx, ...prev.transactions],
      config: { ...prev.config, lastPaymentMethod: tx.paymentMethod },
    })); // optimista
    mutate({ action: "addTransaction", tx });
  }, [mutate]);

  const deleteTransaction = useCallback((id) => {
    setData((prev) => ({ ...prev, transactions: prev.transactions.filter((t) => t.id !== id) }));
    mutate({ action: "deleteTransaction", id });
  }, [mutate]);

  const setIncome = useCallback((mk, amount) => {
    setData((prev) => ({
      ...prev,
      income: { ...prev.income, [mk]: { amount, updatedAt: new Date().toISOString() } },
    }));
    mutate({ action: "setIncome", monthKey: mk, amount });
  }, [mutate]);

  const addSavingsMovement = useCallback((mv) => {
    setData((prev) => ({ ...prev, savings: [mv, ...prev.savings] }));
    mutate({ action: "addSavings", mv });
  }, [mutate]);

  const deleteSavingsMovement = useCallback((id) => {
    setData((prev) => ({ ...prev, savings: prev.savings.filter((m) => m.id !== id) }));
    mutate({ action: "deleteSavings", id });
  }, [mutate]);

  const setCierreDay = useCallback((day) => {
    setData((prev) => ({ ...prev, config: { ...prev.config, cierreDay: day } }));
    mutate({ action: "setConfig", key: "cierreDay", value: day });
  }, [mutate]);

  return {
    data, ready, saveError, refresh, addTransaction, deleteTransaction, setIncome,
    addSavingsMovement, deleteSavingsMovement, setCierreDay,
  };
}

/* ------------------------------------------------------------------ */
/* Teclado numérico                                                    */
/* ------------------------------------------------------------------ */

function Keypad({ value, onChange }) {
  const press = (k) => {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === "." && value.includes(".")) return;
    if (value === "0" && k !== ".") return onChange(k);
    onChange(value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  return (
    <div className="grid grid-cols-3 gap-2 w-full max-w-xs mx-auto">
      {keys.map((k) => (
        <button
          key={k}
          onClick={() => press(k)}
          className="h-16 rounded-2xl bg-slate-100 active:bg-slate-200 text-2xl font-semibold text-slate-800 flex items-center justify-center select-none"
        >
          {k === "back" ? "⌫" : k}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña 1: Cargar gasto                                             */
/* ------------------------------------------------------------------ */

function EntryTab({ addTransaction, config }) {
  const [path, setPath] = useState([]);
  const [step, setStep] = useState("cat");
  const [freeTextInput, setFreeTextInput] = useState("");
  const [pendingFreeText, setPendingFreeText] = useState(null);
  const [amount, setAmount] = useState("0");
  const [concept, setConcept] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(config.lastPaymentMethod || "no_credito");
  const [dateInput, setDateInput] = useState(toDatetimeLocalValue(new Date()));
  const [editingDate, setEditingDate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const geoRef = useRef(null);

  useEffect(() => {
    getLocation().then((loc) => { geoRef.current = loc; });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const rootColor = path[0]?.color || "#334155";
  const rootAccent = rootColor === "#ffffff" ? (path[0]?.dark || "#334155") : rootColor;

  function reset() {
    setPath([]);
    setStep("cat");
    setAmount("0");
    setConcept("");
    setFreeTextInput("");
    setPendingFreeText(null);
    setDateInput(toDatetimeLocalValue(new Date()));
    setEditingDate(false);
    // paymentMethod NO se resetea: se mantiene la última usada para agilizar la próxima carga
  }

  function pickCategory(cat) {
    const node = {
      level: "cat", key: cat.key, label: cat.label, emoji: cat.emoji, color: cat.color, dark: cat.dark,
      conceptPlaceholder: cat.conceptPlaceholder,
    };
    if (cat.freeText && !cat.subs) {
      setPendingFreeText({ parent: [node] });
      setPath([node]);
      setStep("sub");
      return;
    }
    setPath([node]);
    if (!cat.subs) {
      setStep("amount");
    } else {
      setStep("sub");
    }
  }

  function pickSub(list, sub, parentPath) {
    const node = { level: "sub", key: sub.key, label: sub.label, emoji: sub.emoji, color: parentPath[0].color };
    if (sub.freeText) {
      setPendingFreeText({ parent: [...parentPath, node] });
      setPath([...parentPath, node]);
      return;
    }
    const newPath = [...parentPath, node];
    setPath(newPath);
    if (sub.fixedAmount != null) setAmount(String(sub.fixedAmount));
    if (sub.subs) {
      setStep("sub");
    } else {
      setStep("amount");
    }
  }

  function confirmFreeText() {
    if (!freeTextInput.trim()) return;
    const newPath = [...pendingFreeText.parent];
    newPath[newPath.length - 1] = { ...newPath[newPath.length - 1], label: freeTextInput.trim(), custom: true };
    setPath(newPath);
    setPendingFreeText(null);
    setFreeTextInput("");
    setStep("amount");
  }

  function currentSubOptions() {
    let cat = CAT_BY_KEY[path[0].key];
    let list = cat.subs;
    for (let i = 1; i < path.length; i++) {
      const node = path[i];
      const found = list?.find((s) => s.key === node.key);
      list = found?.subs || null;
    }
    return list || [];
  }

  async function handleSave() {
    const num = parseFloat(amount);
    if (!num || num <= 0) return;
    setSaving(true);
    const loc = geoRef.current || (await getLocation());
    const now = new Date(dateInput);
    const tx = {
      id: uid(),
      ts: now.toISOString(),
      amount: num,
      category: path[0].label,
      categoryKey: path[0].key,
      categoryColor: rootAccent,
      subcategory: path[1]?.label || null,
      detail: path[2]?.label || null,
      concept: concept.trim() || null,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      paymentMethod,
      chargeMonth: computeChargeMonth(now, paymentMethod, config.cierreDay),
    };
    addTransaction(tx);
    setSaving(false);
    setToast("Guardado ✅");
    reset();
    getLocation().then((l) => { geoRef.current = l; });
  }

  const breadcrumb = path.map((p) => `${p.emoji || ""} ${p.label}`).join(" › ");

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2 rounded-full text-sm shadow-lg z-50">
          {toast}
        </div>
      )}

      {path.length > 0 && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-sm text-slate-500">
          <button onClick={reset} className="text-slate-400 active:text-slate-600">↺ empezar de nuevo</button>
          <span className="ml-auto font-medium" style={{ color: rootAccent }}>{breadcrumb}</span>
        </div>
      )}

      {step === "cat" && (
        <div className="grid grid-cols-2 gap-3 p-4 overflow-y-auto">
          {CATS.map((c) => {
            const isLight = c.color === "#ffffff";
            return (
              <button
                key={c.key}
                onClick={() => pickCategory(c)}
                style={{
                  backgroundColor: c.color,
                  color: isLight ? c.dark : "#ffffff",
                  border: isLight ? `2px solid ${c.dark}22` : "none",
                }}
                className="rounded-3xl p-4 h-28 flex flex-col items-center justify-center gap-1 shadow-sm active:scale-95 transition-transform"
              >
                <span className="text-3xl">{c.emoji}</span>
                <span className="text-sm font-semibold text-center leading-tight">{c.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {step === "sub" && !pendingFreeText && (
        <div className="grid grid-cols-2 gap-3 p-4 overflow-y-auto">
          {currentSubOptions().map((s) => (
            <button
              key={s.key}
              onClick={() => pickSub(currentSubOptions(), s, path)}
              style={{ backgroundColor: rootAccent + "1a", color: rootAccent, borderColor: rootAccent }}
              className="rounded-2xl p-4 h-24 flex flex-col items-center justify-center gap-1 border-2 active:scale-95 transition-transform"
            >
              {s.emoji && <span className="text-2xl">{s.emoji}</span>}
              <span className="text-sm font-semibold text-center leading-tight">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {step === "sub" && pendingFreeText && (
        <div className="flex flex-col gap-4 p-6">
          <p className="text-slate-600 text-sm">Escribí un nombre para esta categoría:</p>
          <input
            autoFocus
            value={freeTextInput}
            onChange={(e) => setFreeTextInput(e.target.value)}
            placeholder="Ej: Reparación auto"
            className="border-2 border-slate-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-slate-400"
          />
          <button
            onClick={confirmFreeText}
            disabled={!freeTextInput.trim()}
            style={{ backgroundColor: rootAccent }}
            className="rounded-xl py-3 text-white font-semibold disabled:opacity-40"
          >
            Continuar
          </button>
        </div>
      )}

      {step === "amount" && (
        <div className="flex flex-col items-center gap-6 p-6 flex-1 overflow-y-auto">
          <div className="text-4xl font-bold tabular-nums" style={{ color: rootAccent }}>
            {CURRENCY} {amount}
          </div>
          <Keypad value={amount} onChange={setAmount} />
          <input
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder={path[0]?.conceptPlaceholder || "Concepto (opcional)"}
            className="w-full max-w-xs border-2 border-slate-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-slate-400"
          />
          {!editingDate ? (
            <button
              onClick={() => setEditingDate(true)}
              className="w-full max-w-xs text-sm text-slate-500 underline text-center"
            >
              📅 {formatDateShort(new Date(dateInput))}
            </button>
          ) : (
            <div className="w-full max-w-xs flex items-center gap-2">
              <input
                type="datetime-local"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="flex-1 border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-slate-400"
              />
              <button onClick={() => setEditingDate(false)} className="text-emerald-600 text-sm font-semibold whitespace-nowrap">
                Listo
              </button>
            </div>
          )}
          <div className="w-full max-w-xs grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentMethod("no_credito")}
              className={`rounded-xl py-2.5 text-sm font-semibold ${
                paymentMethod === "no_credito" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              💵 Débito·Twint·Efectivo
            </button>
            <button
              onClick={() => setPaymentMethod("credito")}
              className={`rounded-xl py-2.5 text-sm font-semibold ${
                paymentMethod === "credito" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              💳 Crédito
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !parseFloat(amount)}
            style={{ backgroundColor: rootAccent }}
            className="w-full max-w-xs rounded-2xl py-4 text-white font-bold text-lg disabled:opacity-40 active:scale-95 transition-transform"
          >
            {saving ? "Guardando…" : "Guardar gasto"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña 2: Balance                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Gráfico de torta (SVG puro, sin librerías externas)                 */
/* ------------------------------------------------------------------ */

function DonutChart({ data, size = 200 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  const strokeWidth = size * 0.24;
  const radius = size / 2;
  const innerRadius = radius - strokeWidth / 2;
  const circumference = 2 * Math.PI * innerRadius;
  let cumulative = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${radius} ${radius})`}>
        <circle cx={radius} cy={radius} r={innerRadius} fill="transparent" stroke="#f1f5f9" strokeWidth={strokeWidth} />
        {data.map((d, i) => {
          const fraction = d.value / total;
          const dash = Math.max(fraction * circumference - 2, 0);
          const offset = -cumulative * circumference;
          cumulative += fraction;
          return (
            <circle
              key={i}
              cx={radius}
              cy={radius}
              r={innerRadius}
              fill="transparent"
              stroke={d.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          );
        })}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Bloque de un mes: ingresos (tocable) / gastos / saldo               */
/* ------------------------------------------------------------------ */

function MonthSummary({ mk, ingreso, gasto, onSaveIncome }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(ingreso || 0));
  const saldo = ingreso - gasto;

  function start() {
    setAmount(ingreso ? String(ingreso) : "0");
    setEditing(true);
  }
  function save() {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    onSaveIncome(mk, n);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-slate-700 capitalize">{monthLabel(mk)}</h3>
      {!editing ? (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={start}
            className="bg-emerald-50 rounded-2xl p-3 text-center active:bg-emerald-100"
          >
            <div className="text-xs text-emerald-700 font-medium">Ingresos</div>
            <div className="text-sm font-bold text-emerald-800">{fmt(ingreso)}</div>
          </button>
          <div className="bg-rose-50 rounded-2xl p-3 text-center">
            <div className="text-xs text-rose-700 font-medium">Gastos</div>
            <div className="text-sm font-bold text-rose-800">{fmt(gasto)}</div>
          </div>
          <div className={`rounded-2xl p-3 text-center ${saldo >= 0 ? "bg-sky-50" : "bg-orange-50"}`}>
            <div className={`text-xs font-medium ${saldo >= 0 ? "text-sky-700" : "text-orange-700"}`}>Saldo</div>
            <div className={`text-sm font-bold ${saldo >= 0 ? "text-sky-800" : "text-orange-800"}`}>{fmt(saldo)}</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 bg-slate-50 rounded-2xl p-4">
          <div className="text-2xl font-bold tabular-nums text-emerald-700">
            {CURRENCY} {amount}
          </div>
          <Keypad value={amount} onChange={setAmount} />
          <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
            <button
              onClick={() => setEditing(false)}
              className="rounded-xl py-2.5 text-sm font-semibold text-slate-500 bg-slate-200"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={!parseFloat(amount)}
              className="rounded-xl py-2.5 text-sm font-semibold text-white bg-emerald-500 disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceTab({ data, setIncome }) {
  const now = new Date();
  const currentMK = monthKey(now);

  const monthTx = data.transactions.filter((t) => monthKey(new Date(t.ts)) === currentMK);
  const incomeRec = data.income[currentMK];
  const ingreso = incomeRec?.amount || 0;

  // "Gastos" del mes actual = lo que realmente sale de la cuenta este mes:
  // no-crédito de este mes + crédito de compras anteriores que vence ahora.
  const gasto = data.transactions
    .filter((t) => (t.chargeMonth || monthKey(new Date(t.ts))) === currentMK)
    .reduce((s, t) => s + t.amount, 0);

  const needsReminder = now.getDate() >= 25 && (!incomeRec ||
    new Date(incomeRec.updatedAt).getMonth() !== now.getMonth() ||
    new Date(incomeRec.updatedAt).getFullYear() !== now.getFullYear());

  const byCat = {};
  monthTx.forEach((t) => {
    if (!byCat[t.categoryKey]) byCat[t.categoryKey] = { name: t.category, value: 0, color: t.categoryColor };
    byCat[t.categoryKey].value += t.amount;
  });
  const pieData = Object.values(byCat);

  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
      {needsReminder && (
        <div className="bg-amber-100 border border-amber-300 text-amber-900 rounded-2xl p-3 text-sm flex items-center justify-between gap-2">
          <span>📅 Es 25 o más tarde — actualizá el ingreso del mes.</span>
        </div>
      )}

      <MonthSummary mk={currentMK} ingreso={ingreso} gasto={gasto} onSaveIncome={setIncome} />

      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        {pieData.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">Todavía no hay gastos este mes.</p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <DonutChart data={pieData} size={200} />
            <div className="w-full flex flex-col gap-1.5">
              {pieData
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="truncate">{d.name}</span>
                    </span>
                    <span className="font-semibold text-slate-700 whitespace-nowrap">{fmt(d.value)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña: Próximos meses (gastos ya comprometidos por crédito)       */
/* ------------------------------------------------------------------ */

function ProximosMesesTab({ data, setIncome, setCierreDay }) {
  const now = new Date();
  const [editingCierre, setEditingCierre] = useState(false);
  const [cierreInput, setCierreInput] = useState(String(data.config.cierreDay));

  const upcomingMonths = [1, 2].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const mk = monthKey(d);
    const gastoComprometido = data.transactions
      .filter((t) => t.chargeMonth === mk)
      .reduce((s, t) => s + t.amount, 0);
    const ingresoMes = data.income[mk]?.amount || 0;
    return { mk, gastoComprometido, ingresoMes };
  });

  function saveCierre() {
    const d = parseInt(cierreInput, 10);
    if (!d || d < 1 || d > 31) return;
    setCierreDay(d);
    setEditingCierre(false);
  }

  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        {!editingCierre ? (
          <button onClick={() => { setCierreInput(String(data.config.cierreDay)); setEditingCierre(true); }} className="underline">
            ⚙️ Día de cierre de la tarjeta: {data.config.cierreDay}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span>Día de cierre:</span>
            <input
              type="number"
              min="1"
              max="31"
              value={cierreInput}
              onChange={(e) => setCierreInput(e.target.value)}
              className="w-14 border border-slate-300 rounded-lg px-2 py-1 text-slate-700 text-sm"
            />
            <button onClick={saveCierre} className="text-emerald-600 font-semibold">Guardar</button>
            <button onClick={() => setEditingCierre(false)} className="text-slate-400">Cancelar</button>
          </div>
        )}
      </div>

      {upcomingMonths.map((m) => (
        <MonthSummary
          key={m.mk}
          mk={m.mk}
          ingreso={m.ingresoMes}
          gasto={m.gastoComprometido}
          onSaveIncome={setIncome}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña 4: Historial                                                 */
/* ------------------------------------------------------------------ */

function HistorialTab({ data, deleteTransaction }) {
  const months = Array.from(new Set(data.transactions.map((t) => monthKey(new Date(t.ts))))).sort().reverse();
  const [filter, setFilter] = useState(months[0] || monthKey(new Date()));
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    if (months.length && !months.includes(filter)) setFilter(months[0]);
  }, [months.join(",")]);

  const filtered = data.transactions
    .filter((t) => monthKey(new Date(t.ts)) === filter)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  function exportCSV() {
    const header = ["Fecha", "Hora", "Categoria", "Subcategoria", "Detalle", "Concepto", "Importe", "MetodoPago", "MesDeCargo", "Latitud", "Longitud"];
    const rows = data.transactions
      .slice()
      .sort((a, b) => new Date(a.ts) - new Date(b.ts))
      .map((t) => {
        const d = new Date(t.ts);
        return [
          d.toLocaleDateString("es-AR"),
          d.toLocaleTimeString("es-AR"),
          t.category,
          t.subcategory || "",
          t.detail || "",
          t.concept || "",
          t.amount.toFixed(2),
          t.paymentMethod === "credito" ? "Credito" : "Debito/Twint/Efectivo",
          t.chargeMonth || "",
          t.lat ?? "",
          t.lng ?? "",
        ];
      });
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 flex flex-col gap-3 overflow-y-auto h-full">
      <div className="flex items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm capitalize flex-1"
        >
          {months.length === 0 && <option value={filter}>{monthLabel(filter)}</option>}
          {months.map((mk) => (
            <option key={mk} value={mk} className="capitalize">{monthLabel(mk)}</option>
          ))}
        </select>
        <button onClick={exportCSV} className="bg-slate-800 text-white rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap">
          ⬇ CSV
        </button>
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-slate-400 text-sm py-8">No hay gastos cargados en este mes.</p>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((t) => {
          const d = new Date(t.ts);
          return (
            <div key={t.id} className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                style={{ backgroundColor: t.categoryColor + "22" }}
              >
                {CAT_BY_KEY[t.categoryKey]?.emoji || "•"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">
                  {[t.category, t.subcategory, t.detail].filter(Boolean).join(" › ")}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {t.concept ? `${t.concept} · ` : ""}{d.toLocaleDateString("es-AR")} {d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                  {t.lat != null ? " · 📍" : ""}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t.paymentMethod === "credito" ? "💳 Crédito" : "💵 Débito·Twint·Efectivo"}
                  {t.paymentMethod === "credito" && t.chargeMonth ? ` · se paga ${monthLabel(t.chargeMonth)}` : ""}
                </div>
              </div>
              <div className="text-sm font-bold text-slate-700 whitespace-nowrap">{fmt(t.amount)}</div>
              {confirmId === t.id ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { deleteTransaction(t.id); setConfirmId(null); }}
                    className="text-xs font-bold text-white bg-rose-500 rounded-lg px-2 py-1.5"
                  >
                    Borrar
                  </button>
                  <button onClick={() => setConfirmId(null)} className="text-xs text-slate-400 px-1.5">
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(t.id)}
                  className="text-slate-300 active:text-rose-500 text-lg px-1"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

function App() {
  const {
    data, ready, saveError, refresh, addTransaction, deleteTransaction, setIncome,
    setCierreDay,
  } = useSharedData();
  const [tab, setTab] = useState("entry");

  useEffect(() => {
    if (tab !== "entry") refresh();
  }, [tab, refresh]);

  const tabs = [
    { key: "entry", label: "Cargar", emoji: "➕" },
    { key: "balance", label: "Balance mensual", emoji: "📊" },
    { key: "proximos", label: "Próximos meses", emoji: "📅" },
    { key: "historial", label: "Historial", emoji: "🧾" },
  ];

  return (
    <div className="w-full h-[100dvh] bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between pt-safe">
        <span className="font-bold">FinanzasAP</span>
        <div className="flex items-center gap-3">
          {saveError && <span className="text-[10px] text-amber-300">⚠ sin conexión al Sheet</span>}
          {tab !== "entry" && (
            <button onClick={refresh} className="text-xs text-slate-300 active:text-white">↻ Actualizar</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {!ready ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">Cargando…</div>
        ) : tab === "entry" ? (
          <EntryTab addTransaction={addTransaction} config={data.config} />
        ) : tab === "balance" ? (
          <BalanceTab data={data} setIncome={setIncome} />
        ) : tab === "proximos" ? (
          <ProximosMesesTab data={data} setIncome={setIncome} setCierreDay={setCierreDay} />
        ) : (
          <HistorialTab data={data} deleteTransaction={deleteTransaction} />
        )}
      </div>

      <div className="grid grid-cols-4 border-t border-slate-200 bg-white pb-safe">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-3 flex flex-col items-center gap-0.5 text-xs font-medium ${
              tab === t.key ? "text-slate-900" : "text-slate-400"
            }`}
          >
            <span className="text-xl">{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
