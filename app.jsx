const { useState, useEffect, useRef, useCallback } = React;

/* ------------------------------------------------------------------ */
/* Backend: Google Apps Script Web App (guarda todo en el Google Sheet)*/
/* Usamos JSONP (carga vía <script>) en vez de fetch() porque Apps      */
/* Script no soporta configurar CORS, y fetch() cross-origin lo bloquea.*/
/* ------------------------------------------------------------------ */
const API_URL = "https://script.google.com/macros/s/AKfycbxp-EcvFamQTvDjcjDjyvwmRMa2qRDsutSdJuwIKkQRGEy6lPA4_i0OiD6D8EMwNsbF1g/exec";

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
  if (payload.currency) params.set("currency", payload.currency);
  if (payload.amount != null) params.set("amount", payload.amount);
  if (payload.mv) params.set("mv", JSON.stringify(payload.mv));
  if (payload.key != null) params.set("key", payload.key);
  if (payload.value != null) params.set("value", payload.value);
  if (payload.asset) params.set("asset", JSON.stringify(payload.asset));
  if (payload.proyecto) params.set("proyecto", JSON.stringify(payload.proyecto));
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

// Datos fijos de cada préstamo (para mostrar debajo del botón de cada uno en Cargar).
const LOAN_TERRENO_CUOTA_INICIO = 55;
const LOAN_TERRENO_CUOTA_FIN = 100;
const LOAN_TERRENO_CUOTA_MENSUAL = 140; // USD

function buildTerrenoInstallments() {
  const out = [];
  for (let n = LOAN_TERRENO_CUOTA_INICIO; n <= LOAN_TERRENO_CUOTA_FIN; n++) {
    out.push({ key: `cuota-terreno-${n}`, label: `Cuota ${n}`, fixedAmountUSD: LOAN_TERRENO_CUOTA_MENSUAL });
  }
  return out;
}
const LOAN_TERRENO_TOTAL_INSTALLMENTS = LOAN_TERRENO_CUOTA_FIN - LOAN_TERRENO_CUOTA_INICIO + 1;

// Préstamos con calendario de vencimiento fijo por mes (clave "cuota-YYYY-MM").
// Luis-Terreno, Procrear, Marcelita, etc. no tienen fecha asignada por cuota,
// así que no entran acá — si en el futuro alguno la tiene, se agrega a esta lista.
const SCHEDULED_LOANS = {
  CHF: [{ catKey: "prestamos", subLabel: "UBS", installments: buildLoanInstallments() }],
  ARS: [],
};

function loanDebtInfo(subKey, data) {
  if (subKey === "ubs") {
    const pagadas = data.transactions.filter((t) => t.categoryKey === "prestamos" && t.subcategory === "UBS").length;
    const restantes = Math.max(12 - pagadas, 0);
    const montoRestante = restantes * LOAN_MONTHLY_AMOUNT;
    return `Restan ${restantes} cuotas de CHF ${LOAN_MONTHLY_AMOUNT.toLocaleString("es-AR")} · Total: CHF ${montoRestante.toLocaleString("es-AR")}`;
  }
  if (subKey === "luis_terreno") {
    const pagadas = data.transactions.filter((t) => t.categoryKey === "prestamos" && t.subcategory === "Luis-Terreno").length;
    const restantes = Math.max(LOAN_TERRENO_TOTAL_INSTALLMENTS - pagadas, 0);
    const montoRestante = restantes * LOAN_TERRENO_CUOTA_MENSUAL;
    return `Restan ${restantes} cuotas de USD ${LOAN_TERRENO_CUOTA_MENSUAL} · Total: USD ${montoRestante.toLocaleString("es-AR")}`;
  }
  if (subKey === "marcelita_rtrader") {
    return `Deuda: CHF 2.000 · Sin intereses ni plazo fijo (familiar)`;
  }
  return null;
}

// Cuota mensual estimada de un préstamo simulado (sistema francés; interés 0 = división simple).
function calcCuotaSimulada(monto, cuotas, tasaPct) {
  const P = parseFloat(monto) || 0;
  const N = parseInt(cuotas, 10) || 0;
  const r = (parseFloat(tasaPct) || 0) / 100;
  if (!P || !N) return 0;
  if (!r) return P / N;
  return (P * r) / (1 - Math.pow(1 + r, -N));
}

const CATS_CHF = [
  {
    key: "alquiler", label: "Gastos fijos", emoji: "🏠🚆", icon: "icon-gastosfijos.png",
    color: "#e0a238", light: "#fdf1dc", dark: "#7a4e08",
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
    key: "supermercado", label: "Víveres", emoji: "🛒", icon: "icon-viveres.png",
    color: "#4a7c59", light: "#e2ede1", dark: "#234229",
    subs: [
      { key: "supermercado", label: "Supermercado" },
      { key: "kiosko", label: "Kiosko" },
      { key: "restaurante", label: "Restaurante" },
    ],
  },
  {
    key: "salud", label: "Salud", emoji: "🌿", icon: "icon-salud.png",
    color: "#8ca86b", light: "#eef3e6", dark: "#435330",
    subs: [
      { key: "farmacia", label: "Farmacia" },
      { key: "seguro_salud", label: "Seguro de salud" },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
  {
    key: "ropa", label: "Ropa", emoji: "👗👔", icon: "icon-ropa.png",
    color: "#bf7e5c", light: "#f8e9e0", dark: "#6b3a22",
    subs: null, conceptPlaceholder: "Ej: zapatillas, campera, ropa interior",
  },
  {
    key: "casa", label: "Hogar & Tecno", emoji: "🛋️", icon: "icon-casa.png",
    color: "#d9ac5c", light: "#faf0dc", dark: "#6b4d16",
    subs: null, conceptPlaceholder: "Ej: mueble, decoración, auriculares, gadget",
  },
  {
    key: "varios", label: "Varios", emoji: "🔀", icon: "icon-varios.png",
    color: "#8a7150", light: "#efe8dd", dark: "#453824",
    subs: null,
  },
  {
    key: "viajes", label: "Viajes", emoji: "✈️", icon: "icon-viajes.png",
    color: "#35543a", light: "#dde8dc", dark: "#1c2e1e",
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
  {
    key: "prestamos", label: "Préstamos", emoji: "💸", icon: "icon-prestamos.png",
    color: "#c17817", light: "#fbe8cc", dark: "#6b3f0a",
    subs: [
      { key: "ubs", label: "UBS", subs: buildLoanInstallments() },
      { key: "marcelita_rtrader", label: "Marcelita Ferro y RTrader", freeText: true },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
];

const CATS_ARS = [
  {
    key: "gastos_fijos_ar", label: "Gastos fijos", emoji: "🏠🚆", icon: "icon-gastosfijos.png",
    color: "#e0a238", light: "#fdf1dc", dark: "#7a4e08",
    subs: [
      {
        key: "auto", label: "Auto",
        subs: [
          { key: "patente", label: "Patente" },
          { key: "seguro_auto", label: "Seguro" },
        ],
      },
      {
        key: "casa_servicios", label: "Casa",
        subs: [
          { key: "electricidad", label: "Electricidad" },
          { key: "gas", label: "Gas" },
          { key: "agua", label: "Agua" },
          { key: "internet", label: "Internet" },
          { key: "seguro_casa", label: "Seguro" },
        ],
      },
      { key: "suscripciones", label: "Suscripciones" },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
  {
    key: "viveres_ar", label: "Víveres", emoji: "🛒", icon: "icon-viveres.png",
    color: "#4a7c59", light: "#e2ede1", dark: "#234229",
    subs: [
      { key: "supermercado", label: "Supermercado" },
      { key: "kiosko", label: "Kiosko" },
      { key: "restaurante", label: "Restaurante" },
    ],
  },
  {
    key: "salud_ar", label: "Salud", emoji: "🌿", icon: "icon-salud.png",
    color: "#8ca86b", light: "#eef3e6", dark: "#435330",
    subs: [
      { key: "seguro_salud", label: "Seguro" },
      { key: "farmacia", label: "Farmacia" },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
  {
    key: "ropa_ar", label: "Ropa", emoji: "👗👔", icon: "icon-ropa.png",
    color: "#bf7e5c", light: "#f8e9e0", dark: "#6b3a22",
    subs: null, conceptPlaceholder: "Ej: zapatillas, campera, ropa interior",
  },
  {
    key: "casa_ar", label: "Hogar & Tecno", emoji: "🛋️", icon: "icon-casa.png",
    color: "#d9ac5c", light: "#faf0dc", dark: "#6b4d16",
    subs: null, conceptPlaceholder: "Ej: mueble, decoración, auriculares, gadget",
  },
  {
    key: "varios_ar", label: "Varios", emoji: "🔀", icon: "icon-varios.png",
    color: "#8a7150", light: "#efe8dd", dark: "#453824",
    subs: null,
  },
  {
    key: "viajes_ar", label: "Viajes", emoji: "✈️", icon: "icon-viajes.png",
    color: "#35543a", light: "#dde8dc", dark: "#1c2e1e",
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
  {
    key: "prestamos_ar", label: "Préstamos", emoji: "💸", icon: "icon-prestamos.png",
    color: "#c17817", light: "#fbe8cc", dark: "#6b3f0a",
    subs: [
      { key: "luis_terreno", label: "Luis-Terreno", subs: buildTerrenoInstallments() },
      { key: "procrear", label: "Procrear", freeText: true },
      { key: "otro", label: "Otro", freeText: true },
    ],
  },
];

const CAT_BY_KEY = Object.fromEntries([...CATS_CHF, ...CATS_ARS].map((c) => [c.key, c]));
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
function fmt(n, currency) {
  return `${currency || CURRENCY} ${Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  const DEFAULT_CONFIG = { cierreDay: 15, lastPaymentMethod: "no_credito", lastCurrency: "CHF", fxRate: "", dailyEstimateCHF: 100, dailyEstimateARS: 40000 };
  const [data, setData] = useState({ transactions: [], income: {}, incomeMovements: [], savings: [], assets: [], proyectos: [], config: DEFAULT_CONFIG });
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const applyFresh = useCallback((fresh) => {
    setData({
      transactions: fresh.transactions || [],
      income: fresh.income || {},
      incomeMovements: fresh.incomeMovements || [],
      savings: fresh.savings || [],
      assets: fresh.assets || [],
      proyectos: fresh.proyectos || [],
      config: { ...DEFAULT_CONFIG, ...(fresh.config || {}) },
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const fresh = await apiGet();
      applyFresh(fresh);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  }, [applyFresh]);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const mutate = useCallback((payload) => {
    apiPost(payload)
      .then(() => {
        setSaveError(false);
      })
      .catch(() => setSaveError(true));
  }, []);

  const addTransaction = useCallback((tx) => {
    setData((prev) => ({
      ...prev,
      transactions: [tx, ...prev.transactions],
      config: { ...prev.config, lastPaymentMethod: tx.paymentMethod, lastCurrency: tx.currency },
    })); // optimista
    mutate({ action: "addTransaction", tx });
  }, [mutate]);

  const deleteTransaction = useCallback((id) => {
    setData((prev) => {
      const idx = prev.transactions.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.transactions.slice();
      next.splice(idx, 1);
      return { ...prev, transactions: next };
    });
    mutate({ action: "deleteTransaction", id });
  }, [mutate]);

  const addIncomeMovement = useCallback((mv) => {
    const key = `${mv.monthKey}:${mv.currency}`;
    setData((prev) => {
      const prevAmt = prev.income[key]?.amount || 0;
      return {
        ...prev,
        incomeMovements: [mv, ...(prev.incomeMovements || [])],
        income: { ...prev.income, [key]: { amount: prevAmt + mv.amount, updatedAt: mv.ts } },
      };
    });
    mutate({ action: "addIncome", mv });
  }, [mutate]);

  const deleteIncomeMovement = useCallback((id) => {
    setData((prev) => {
      const list = prev.incomeMovements || [];
      const idx = list.findIndex((m) => m.id === id);
      if (idx === -1) return prev;
      const mv = list[idx];
      const key = `${mv.monthKey}:${mv.currency}`;
      const prevAmt = prev.income[key]?.amount || 0;
      const next = list.slice();
      next.splice(idx, 1);
      return {
        ...prev,
        incomeMovements: next,
        income: { ...prev.income, [key]: { amount: prevAmt - mv.amount, updatedAt: new Date().toISOString() } },
      };
    });
    mutate({ action: "deleteIncome", id });
  }, [mutate]);

  const addSavingsMovement = useCallback((mv) => {
    setData((prev) => ({ ...prev, savings: [mv, ...prev.savings] }));
    mutate({ action: "addSavings", mv });
  }, [mutate]);

  const deleteSavingsMovement = useCallback((id) => {
    setData((prev) => {
      const idx = prev.savings.findIndex((m) => m.id === id);
      if (idx === -1) return prev;
      const next = prev.savings.slice();
      next.splice(idx, 1);
      return { ...prev, savings: next };
    });
    mutate({ action: "deleteSavings", id });
  }, [mutate]);

  const setCierreDay = useCallback((day) => {
    setData((prev) => ({ ...prev, config: { ...prev.config, cierreDay: day } }));
    mutate({ action: "setConfig", key: "cierreDay", value: day });
  }, [mutate]);

  const setFxRate = useCallback((rate) => {
    setData((prev) => ({ ...prev, config: { ...prev.config, fxRate: rate } }));
    mutate({ action: "setConfig", key: "fxRate", value: rate });
  }, [mutate]);

  const setDailyEstimate = useCallback((currency, value) => {
    const key = currency === "CHF" ? "dailyEstimateCHF" : "dailyEstimateARS";
    setData((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }));
    mutate({ action: "setConfig", key, value });
  }, [mutate]);

  const setHiddenLoans = useCallback((csv) => {
    setData((prev) => ({ ...prev, config: { ...prev.config, hiddenLoans: csv } }));
    mutate({ action: "setConfig", key: "hiddenLoans", value: csv });
  }, [mutate]);

  const saveAsset = useCallback((asset) => {
    setData((prev) => {
      const exists = prev.assets.some((a) => a.id === asset.id);
      const assets = exists
        ? prev.assets.map((a) => (a.id === asset.id ? asset : a))
        : [asset, ...prev.assets];
      return { ...prev, assets };
    });
    mutate({ action: "saveAsset", asset });
  }, [mutate]);

  const deleteAsset = useCallback((id) => {
    setData((prev) => {
      const idx = prev.assets.findIndex((a) => a.id === id);
      if (idx === -1) return prev;
      const next = prev.assets.slice();
      next.splice(idx, 1);
      return { ...prev, assets: next };
    });
    mutate({ action: "deleteAsset", id });
  }, [mutate]);

  const saveProyecto = useCallback((proyecto) => {
    setData((prev) => {
      const proyectos = prev.proyectos || [];
      const exists = proyectos.some((p) => p.id === proyecto.id);
      const next = exists
        ? proyectos.map((p) => (p.id === proyecto.id ? proyecto : p))
        : [proyecto, ...proyectos];
      return { ...prev, proyectos: next };
    });
    mutate({ action: "saveProyecto", proyecto });
  }, [mutate]);

  const deleteProyecto = useCallback((id) => {
    setData((prev) => {
      const list = prev.proyectos || [];
      const idx = list.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const next = list.slice();
      next.splice(idx, 1);
      return { ...prev, proyectos: next };
    });
    mutate({ action: "deleteProyecto", id });
  }, [mutate]);

  return {
    data, ready, saveError, refresh, addTransaction, deleteTransaction, addIncomeMovement, deleteIncomeMovement,
    addSavingsMovement, deleteSavingsMovement, setCierreDay, setFxRate, setDailyEstimate, setHiddenLoans, saveAsset, deleteAsset,
    saveProyecto, deleteProyecto,
  };
}

/* ------------------------------------------------------------------ */
/* Teclado numérico                                                    */
/* ------------------------------------------------------------------ */

function Keypad({ value, onChange }) {
  const press = (k) => {
    if (k === "back") return onChange(value.slice(0, -1));
    const sign = value.startsWith("-") ? "-" : "";
    const digits = sign ? value.slice(1) : value;
    if (k === "." && digits.includes(".")) return;
    if (digits === "0" && k !== ".") return onChange(sign + k);
    onChange(value + k);
  };
  const toggleSign = () => onChange(value.startsWith("-") ? value.slice(1) : "-" + value);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  return (
    <div className="w-full max-w-xs mx-auto flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
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
      <button
        onClick={toggleSign}
        className="h-11 rounded-2xl bg-slate-200 active:bg-slate-300 text-sm font-semibold text-slate-600 select-none"
      >
        {value.startsWith("-") ? "± Convertir a positivo" : "± Convertir a negativo (devolución)"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña 1: Cargar gasto                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Salud financiera: proyección de caja + estado, para decidir mejor   */
/* ------------------------------------------------------------------ */

function FinancialHealthPanel({ data, currency, setDailyEstimate }) {
  const now = new Date();
  const effMonth = (t) => t.chargeMonth || monthKey(new Date(t.ts));
  // Rojo: Gastos fijos + Salud + Víveres. Naranja: Préstamos + cualquier gasto en crédito.
  const FIXED_CAT_KEYS = currency === "CHF"
    ? ["alquiler", "salud", "supermercado"]
    : ["gastos_fijos_ar", "salud_ar", "viveres_ar"];
  const LOAN_CAT_KEYS = currency === "CHF" ? ["prestamos"] : ["prestamos_ar"];

  const monthsData = [0, 1, 2].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const mk = monthKey(d);
    const monthTx = data.transactions.filter((t) => t.currency === currency && effMonth(t) === mk);
    // Cada gasto cae en UNA sola categoría (sin doble conteo), para que
    // fijos + crédito + variables sume siempre exacto el gasto total del mes.
    let fijosReal = 0, credito = 0, variables = 0;
    monthTx.forEach((t) => {
      if (FIXED_CAT_KEYS.includes(t.categoryKey)) fijosReal += t.amount;
      else if (LOAN_CAT_KEYS.includes(t.categoryKey) || t.paymentMethod === "credito") credito += t.amount;
      else variables += t.amount;
    });
    // Préstamos con vencimiento fijo (ej. UBS) que caen este mes calendario:
    // si esa cuota puntual todavía no se cargó como gasto real, se suma acá
    // como proyectado — así octubre ya "ve" la cuota UBS aunque no se haya
    // tocado el botón todavía.
    (SCHEDULED_LOANS[currency] || []).forEach((loan) => {
      const inst = loan.installments.find((ins) => ins.key === `cuota-${mk}`);
      if (!inst) return;
      const yaCargada = data.transactions.some(
        (t) => t.currency === currency && t.categoryKey === loan.catKey && t.subcategory === loan.subLabel && t.detail === inst.label
      );
      if (!yaCargada) credito += inst.fixedAmount;
    });
    const gastoTotal = monthTx.reduce((s, t) => s + t.amount, 0);
    const ingreso = data.income[`${mk}:${currency}`]?.amount || 0;
    return { mk, ingreso, fijosReal, credito, variables, gastoTotal };
  });
  // Meses futuros (2do, 3ro...): los gastos fijos todavía no están cargados, así
  // que se estiman igual al mes en curso (1ro de la serie) — el crédito, en
  // cambio, refleja solo lo ya comprometido de verdad (ej. cuotas ya cargadas).
  monthsData.forEach((m, i) => {
    m.gastoFijo = i === 0 ? m.fijosReal : monthsData[0].fijosReal;
    m.gastoFijoEstimado = i > 0;
    m.gastoComprometido = m.gastoFijo + m.credito;
  });

  // Saldo del mes en curso = ingreso menos el gasto TOTAL (todas las categorías).
  const currentMK = monthKey(now);
  const saldoActual = monthsData[0].ingreso - monthsData[0].gastoTotal;

  // Próximo ingreso: día 25 en Suiza, día 1 en Argentina.
  const diaIngreso = currency === "CHF" ? 25 : 1;
  let proximoIngreso = new Date(now.getFullYear(), now.getMonth(), diaIngreso);
  if (proximoIngreso <= now) proximoIngreso = new Date(now.getFullYear(), now.getMonth() + 1, diaIngreso);
  const diasHastaIngreso = Math.max(1, Math.ceil((proximoIngreso - now) / 86400000));

  const dailyEstimate = currency === "CHF" ? (data.config.dailyEstimateCHF || 100) : (data.config.dailyEstimateARS || 40000);
  const necesario = dailyEstimate * diasHastaIngreso;
  const ratio = necesario > 0 ? (saldoActual / necesario) * 100 : (saldoActual >= 0 ? 200 : 0);

  let status;
  if (ratio >= 125) {
    status = { emoji: "🟢", bg: "bg-emerald-50", text: "text-emerald-700", label: "¡El mango crece!" };
  } else if (ratio >= 100) {
    status = { emoji: "🟢", bg: "bg-emerald-50", text: "text-emerald-700", label: "Mango con buena salud" };
  } else if (ratio >= 75) {
    status = { emoji: "🟡", bg: "bg-amber-50", text: "text-amber-700", label: "Ojo con el mango" };
  } else {
    status = { emoji: "🔴", bg: "bg-rose-50", text: "text-rose-700", label: "Se pudrió el mango" };
  }

  const [editingDaily, setEditingDaily] = useState(false);
  const [dailyInput, setDailyInput] = useState(String(dailyEstimate));

  function saveDaily() {
    const v = parseFloat(dailyInput);
    if (!v) return;
    setDailyEstimate(currency, v);
    setEditingDaily(false);
  }

  const maxVal = Math.max(1, ...monthsData.flatMap((m) => [m.ingreso, m.gastoFijo + m.credito + m.variables]));
  const panelTitle = currency === "CHF" ? "La salud del mango suizo" : "La salud del mango argentino";

  return (
    <div className="mx-4 mb-4 bg-white rounded-2xl border border-slate-100 p-4 flex flex-col gap-3">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <img src="apple-touch-icon.png" alt="" className="w-9 h-9 rounded-lg" />
        <div className="text-2xl font-bold text-slate-700">{panelTitle}</div>
      </div>
      <div className={`rounded-xl p-2.5 flex items-start gap-2 ${status.bg}`}>
        <span>{status.emoji}</span>
        <span className={`text-xs font-semibold ${status.text}`}>Estado: {status.label}</span>
      </div>

      <div className="flex flex-col gap-2.5 pt-1">
        {monthsData.map((m) => (
          <div key={m.mk} className="flex flex-col gap-1">
            <div className="text-xs text-slate-500 capitalize">{monthLabel(m.mk)}</div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-emerald-400" style={{ width: `${(m.ingreso / maxVal) * 100}%` }} />
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
              <div
                className="h-full bg-yellow-400"
                style={{ width: `${(m.gastoFijo / maxVal) * 100}%`, opacity: m.gastoFijoEstimado ? 0.55 : 1 }}
              />
              <div className="h-full bg-orange-400" style={{ width: `${(m.credito / maxVal) * 100}%` }} />
              <div className="h-full bg-rose-400" style={{ width: `${(m.variables / maxVal) * 100}%` }} />
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-0.5 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Ingreso</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Gastos fijos</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> Crédito</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400" /> Gastos variables</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
        <span>Saldo del mes ({diasHastaIngreso} días para el próximo ingreso)</span>
        <span className={`font-semibold ${saldoActual >= 0 ? "text-sky-600" : "text-rose-600"}`}>{fmt(saldoActual, currency)}</span>
      </div>
      <div className="text-[10px] text-slate-400">
        {!editingDaily ? (
          <button onClick={() => { setDailyInput(String(dailyEstimate)); setEditingDaily(true); }} className="underline">
            ⚙️ Gasto diario estimado (2 personas): {fmt(dailyEstimate, currency)}/día
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              value={dailyInput}
              onChange={(e) => setDailyInput(e.target.value)}
              className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-slate-700 text-xs"
            />
            <button onClick={saveDaily} className="text-emerald-600 font-semibold">Guardar</button>
            <button onClick={() => setEditingDaily(false)} className="text-slate-400">Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryTab({ addTransaction, config, data, setHiddenLoans, setFxRate, setDailyEstimate }) {
  const [path, setPath] = useState([]);
  const [step, setStep] = useState("cat");
  const [freeTextInput, setFreeTextInput] = useState("");
  const [pendingFreeText, setPendingFreeText] = useState(null);
  const [amount, setAmount] = useState("0");
  const [concept, setConcept] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("no_credito");
  const [currency, setCurrency] = useState("CHF");
  const [dateInput, setDateInput] = useState(toDatetimeLocalValue(new Date()));
  const [editingDate, setEditingDate] = useState(false);
  const [simMonto, setSimMonto] = useState("");
  const [simCuotas, setSimCuotas] = useState("");
  const [simTasa, setSimTasa] = useState("0");
  const [confirmDeleteLoan, setConfirmDeleteLoan] = useState(null);
  const hiddenLoansArr = (config.hiddenLoans || "").split(",").filter(Boolean);
  const [fxAmountUSD, setFxAmountUSD] = useState(0);
  const [fxRateInput, setFxRateInput] = useState("");

  function hideLoan(key) {
    setHiddenLoans([...hiddenLoansArr, key].join(","));
    setConfirmDeleteLoan(null);
  }
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const geoRef = useRef(null);
  const savingRef = useRef(false); // guardia sincrónica: evita duplicar si se toca "Guardar" dos veces rápido

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
    setPaymentMethod("no_credito");
    setSimMonto("");
    setSimCuotas("");
    setSimTasa("0");
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
    if (sub.loanSimulator) {
      setPath([...parentPath, node]);
      setStep("simulator");
      return;
    }
    if (sub.fixedAmountUSD != null) {
      setPath([...parentPath, node]);
      setFxAmountUSD(sub.fixedAmountUSD);
      setFxRateInput(config.fxRate ? String(config.fxRate) : "");
      setStep("fxconvert");
      return;
    }
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
    if (savingRef.current) return;
    const num = parseFloat(amount);
    if (!num) return;
    savingRef.current = true;
    setSaving(true);
    try {
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
        currency,
      };
      addTransaction(tx);
      setToast("Guardado ✅");
      reset();
      getLocation().then((l) => { geoRef.current = l; });
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
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
        <div className="overflow-y-auto flex-1">
          <div className="px-4 pt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => setCurrency("CHF")}
              className={`rounded-xl py-2.5 text-sm font-semibold ${
                currency === "CHF" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              🇨🇭 Suiza (CHF)
            </button>
            <button
              onClick={() => setCurrency("ARS")}
              className={`rounded-xl py-2.5 text-sm font-semibold ${
                currency === "ARS" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              🇦🇷 Argentina (ARS)
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {(currency === "CHF" ? CATS_CHF : CATS_ARS).map((c) => {
              return (
                <button
                  key={c.key}
                  onClick={() => pickCategory(c)}
                  style={{ color: c.dark }}
                  className="rounded-3xl px-2 pt-2 pb-2 h-36 flex flex-col items-center active:scale-95 transition-transform overflow-hidden"
                >
                  <div className="flex-1 w-full min-h-0 flex items-center justify-center">
                    {c.icon ? (
                      <img src={c.icon} alt="" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-4xl">{c.emoji}</span>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-center leading-tight pb-1">{c.label}</span>
                </button>
              );
            })}
          </div>
          <FinancialHealthPanel data={data} currency={currency} setDailyEstimate={setDailyEstimate} />
        </div>
      )}

      {step === "sub" && !pendingFreeText && (path[0]?.key === "prestamos" || path[0]?.key === "prestamos_ar") && (
        <div className="grid grid-cols-2 gap-3 p-4 overflow-y-auto">
          {currentSubOptions()
            .filter((s) => !hiddenLoansArr.includes(s.key))
            .map((s) => {
              const debtInfo = loanDebtInfo(s.key, data);
              const deletable = ["ubs", "luis_terreno", "procrear", "marcelita_rtrader"].includes(s.key);
              return (
                <div
                  key={s.key}
                  style={{ backgroundColor: rootAccent + "1a", color: rootAccent, borderColor: rootAccent }}
                  className="rounded-2xl p-3 h-auto min-h-24 flex flex-col items-center gap-1 border-2"
                >
                  <button
                    onClick={() => pickSub(currentSubOptions(), s, path)}
                    className="flex flex-col items-center gap-1 w-full active:scale-95 transition-transform"
                  >
                    {s.emoji && <span className="text-2xl">{s.emoji}</span>}
                    <span className="text-sm font-semibold text-center leading-tight">{s.label}</span>
                    {debtInfo && <span className="text-[10px] text-center leading-tight opacity-80 mt-0.5">{debtInfo}</span>}
                  </button>
                  {deletable && (
                    confirmDeleteLoan === s.key ? (
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          onClick={() => hideLoan(s.key)}
                          className="text-[10px] font-bold text-white bg-rose-500 rounded-lg px-2 py-1"
                        >
                          Confirmar
                        </button>
                        <button onClick={() => setConfirmDeleteLoan(null)} className="text-[10px] opacity-70">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteLoan(s.key)}
                        className="text-[10px] underline opacity-70 mt-1"
                      >
                        🗑 Marcar como pagado
                      </button>
                    )
                  )}
                </div>
              );
            })}
        </div>
      )}

      {step === "sub" && !pendingFreeText && path[0]?.key !== "prestamos" && path[0]?.key !== "prestamos_ar" && (
        <div className="grid grid-cols-2 gap-3 p-4 overflow-y-auto">
          {currentSubOptions().map((s) => (
            <button
              key={s.key}
              onClick={() => pickSub(currentSubOptions(), s, path)}
              style={{ backgroundColor: rootAccent + "1a", color: rootAccent, borderColor: rootAccent }}
              className="rounded-2xl p-4 h-auto min-h-24 flex flex-col items-center justify-center gap-1 border-2 active:scale-95 transition-transform"
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

      {step === "simulator" && (
        <div className="flex flex-col gap-4 p-6 overflow-y-auto">
          <p className="text-slate-700 text-sm font-semibold">🧮 Simulador de préstamo</p>
          <div>
            <label className="text-xs text-slate-500">Monto del préstamo</label>
            <input
              type="number"
              value={simMonto}
              onChange={(e) => setSimMonto(e.target.value)}
              placeholder="Ej: 5000"
              className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Número de cuotas</label>
            <input
              type="number"
              value={simCuotas}
              onChange={(e) => setSimCuotas(e.target.value)}
              placeholder="Ej: 12"
              className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Interés mensual % (opcional, 0 si no aplica)</label>
            <input
              type="number"
              value={simTasa}
              onChange={(e) => setSimTasa(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-slate-400"
            />
          </div>
          <div className="bg-slate-50 rounded-2xl p-4 text-center">
            <div className="text-xs text-slate-500">Cuota mensual estimada</div>
            <div className="text-2xl font-bold text-slate-800">
              {currency} {calcCuotaSimulada(simMonto, simCuotas, simTasa).toLocaleString("es-AR", { maximumFractionDigits: 2 })}
            </div>
          </div>
          <button
            onClick={() => {
              const cuota = calcCuotaSimulada(simMonto, simCuotas, simTasa);
              setAmount(String(Math.round(cuota * 100) / 100));
              setConcept(`Simulación: ${simMonto} en ${simCuotas} cuotas${parseFloat(simTasa) ? ` al ${simTasa}%` : ""}`);
              setStep("amount");
            }}
            disabled={!parseFloat(simMonto) || !parseInt(simCuotas, 10)}
            style={{ backgroundColor: rootAccent }}
            className="rounded-xl py-3 text-white font-semibold disabled:opacity-40"
          >
            Usar esta cuota
          </button>
        </div>
      )}

      {step === "fxconvert" && (
        <div className="flex flex-col gap-4 p-6 overflow-y-auto">
          <p className="text-slate-700 text-sm font-semibold">💱 Cuota en dólares</p>
          <div className="bg-slate-50 rounded-2xl p-4 text-center">
            <div className="text-xs text-slate-500">Cuota</div>
            <div className="text-2xl font-bold text-slate-800">USD {fxAmountUSD}</div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Tasa de cambio (1 USD = ? ARS)</label>
            <input
              type="number"
              autoFocus
              value={fxRateInput}
              onChange={(e) => setFxRateInput(e.target.value)}
              placeholder="Ej: 1200"
              className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-slate-400"
            />
          </div>
          <div className="bg-slate-50 rounded-2xl p-4 text-center">
            <div className="text-xs text-slate-500">Equivale a</div>
            <div className="text-2xl font-bold text-slate-800">
              ARS {(fxAmountUSD * (parseFloat(fxRateInput) || 0)).toLocaleString("es-AR", { maximumFractionDigits: 2 })}
            </div>
          </div>
          <button
            onClick={() => {
              const rate = parseFloat(fxRateInput) || 0;
              setAmount(String(Math.round(fxAmountUSD * rate * 100) / 100));
              if (rate) setFxRate(rate);
              setStep("amount");
            }}
            disabled={!parseFloat(fxRateInput)}
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
            {currency} {amount}
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
/* Desglose de gastos por categoría, con detalle desplegable           */
/* ------------------------------------------------------------------ */

function CategoryDetail({ transactions, currency }) {
  const [expanded, setExpanded] = useState(null);

  const byCat = {};
  transactions.forEach((t) => {
    const currentName = CAT_BY_KEY[t.categoryKey]?.label || t.category;
    if (!byCat[t.categoryKey]) byCat[t.categoryKey] = { name: currentName, color: t.categoryColor, value: 0, items: [] };
    byCat[t.categoryKey].value += t.amount;
    byCat[t.categoryKey].items.push(t);
  });
  const pieData = Object.entries(byCat).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.value - a.value);

  if (pieData.length === 0) {
    return <p className="text-center text-slate-400 text-sm py-6">No hay gastos para mostrar.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <DonutChart data={pieData} size={180} />
      <div className="w-full flex flex-col gap-1">
        {pieData.map((d) => (
          <div key={d.key} className="flex flex-col">
            <button
              onClick={() => setExpanded(expanded === d.key ? null : d.key)}
              className="flex items-center justify-between text-sm py-1.5"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                <span className="truncate">{d.name}</span>
                <span className="text-slate-300">{expanded === d.key ? "▲" : "▼"}</span>
              </span>
              <span className="font-semibold text-slate-700 whitespace-nowrap">{fmt(d.value, currency)}</span>
            </button>
            {expanded === d.key && (
              <div className="pl-5 flex flex-col gap-1 pb-2">
                {d.items
                  .sort((a, b) => new Date(b.ts) - new Date(a.ts))
                  .map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-xs text-slate-500">
                      <span className="truncate pr-2">
                        {[t.subcategory, t.detail, t.concept].filter(Boolean).join(" · ") || "—"}
                      </span>
                      <span className="whitespace-nowrap">{fmt(t.amount, currency)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bloque de un mes: ingresos (tocable) / gastos (tocable) / saldo     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Selector de país (mismo estilo que en Cargar)                       */
/* ------------------------------------------------------------------ */

function CountryToggle({ currency, setCurrency }) {
  return (
    <div className="px-4 pt-4 grid grid-cols-2 gap-2">
      <button
        onClick={() => setCurrency("CHF")}
        className={`rounded-xl py-2.5 text-sm font-semibold ${
          currency === "CHF" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"
        }`}
      >
        🇨🇭 Suiza (CHF)
      </button>
      <button
        onClick={() => setCurrency("ARS")}
        className={`rounded-xl py-2.5 text-sm font-semibold ${
          currency === "ARS" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"
        }`}
      >
        🇦🇷 Argentina (ARS)
      </button>
    </div>
  );
}

function MonthSummary({ mk, currency, ingreso, transactions, incomeMovements, onAddIncome, onDeleteIncome, defaultOpen }) {
  const [activePanel, setActivePanel] = useState(defaultOpen || null); // null | "ingreso" | "gasto"
  const [amount, setAmount] = useState("0");
  const [concept, setConcept] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const gasto = transactions.reduce((s, t) => s + t.amount, 0);
  const saldo = ingreso - gasto;
  const showIncome = activePanel === "ingreso";
  const showDetail = activePanel === "gasto";

  function toggleIncome() {
    setActivePanel((v) => (v === "ingreso" ? null : "ingreso"));
  }
  function toggleDetail() {
    setActivePanel((v) => (v === "gasto" ? null : "gasto"));
  }

  function addMovement() {
    const n = parseFloat(amount);
    if (!n) return;
    onAddIncome({ id: uid(), monthKey: mk, currency, amount: n, concept: concept.trim() || null, ts: new Date().toISOString() });
    setAmount("0");
    setConcept("");
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-slate-700 capitalize">{monthLabel(mk)}</h3>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={toggleIncome}
          className={`bg-emerald-50 rounded-2xl p-3 text-center active:bg-emerald-100 ${showIncome ? "border-2 border-emerald-400" : "border-2 border-transparent"}`}
        >
          <div className="text-xs text-emerald-700 font-medium">Ingresos</div>
          <div className="text-sm font-bold text-emerald-800">{fmt(ingreso, currency)}</div>
        </button>
        <button
          onClick={toggleDetail}
          className={`bg-rose-50 rounded-2xl p-3 text-center active:bg-rose-100 ${showDetail ? "border-2 border-rose-400" : "border-2 border-transparent"}`}
        >
          <div className="text-xs text-rose-700 font-medium">Gastos</div>
          <div className="text-sm font-bold text-rose-800">{fmt(gasto, currency)}</div>
        </button>
        <div className={`rounded-2xl p-3 text-center ${saldo >= 0 ? "bg-sky-50" : "bg-orange-50"}`}>
          <div className={`text-xs font-medium ${saldo >= 0 ? "text-sky-700" : "text-orange-700"}`}>Saldo</div>
          <div className={`text-sm font-bold ${saldo >= 0 ? "text-sky-800" : "text-orange-800"}`}>{fmt(saldo, currency)}</div>
        </div>
      </div>

      {showIncome && (
        <div className="flex flex-col gap-3 bg-slate-50 rounded-2xl p-4 mt-1">
          <div className="text-2xl font-bold tabular-nums text-emerald-700 text-center">
            {currency} {amount}
          </div>
          <Keypad value={amount} onChange={setAmount} />
          <input
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Concepto (ej: Sueldo, Freelance)"
            className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-slate-400"
          />
          <button
            onClick={addMovement}
            disabled={!parseFloat(amount)}
            className="rounded-xl py-2.5 text-sm font-semibold text-white bg-emerald-500 disabled:opacity-40"
          >
            + Agregar ingreso
          </button>

          {incomeMovements.length > 0 && (
            <div className="flex flex-col gap-2 pt-1 border-t border-slate-200">
              {incomeMovements.map((m) => (
                <div key={m.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm">
                  <span className="truncate pr-2 text-slate-600">{m.concept || "Ingreso"}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-semibold text-emerald-700">{fmt(m.amount, currency)}</span>
                    {confirmId === m.id ? (
                      <>
                        <button
                          onClick={() => { onDeleteIncome(m.id); setConfirmId(null); }}
                          className="text-xs font-bold text-white bg-rose-500 rounded-lg px-2 py-1"
                        >
                          Borrar
                        </button>
                        <button onClick={() => setConfirmId(null)} className="text-xs text-slate-400">Cancelar</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmId(m.id)} className="text-slate-300 active:text-rose-500">✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showDetail && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4 mt-1">
          <CategoryDetail transactions={transactions} currency={currency} />
        </div>
      )}
    </div>
  );
}

function BalanceTab({ data, currency, setCurrency, addIncomeMovement, deleteIncomeMovement }) {
  const now = new Date();
  const currentMK = monthKey(now);

  // "Este mes" = lo que realmente sale/entra de la cuenta este mes, siempre
  // por chargeMonth — así el desglose por categoría coincide con el total
  // (una compra con tarjeta que se cobra el mes que viene NO cuenta acá).
  const monthTx = data.transactions.filter(
    (t) => t.currency === currency && (t.chargeMonth || monthKey(new Date(t.ts))) === currentMK
  );
  const incomeRec = data.income[`${currentMK}:${currency}`];
  const ingreso = incomeRec?.amount || 0;

  const needsReminder = now.getDate() >= 25 && (!incomeRec ||
    new Date(incomeRec.updatedAt).getMonth() !== now.getMonth() ||
    new Date(incomeRec.updatedAt).getFullYear() !== now.getFullYear());

  return (
    <div className="flex flex-col gap-4 overflow-y-auto h-full">
      <CountryToggle currency={currency} setCurrency={setCurrency} />
      <div className="px-4 pb-4 flex flex-col gap-4">
        {needsReminder && (
          <div className="bg-amber-100 border border-amber-300 text-amber-900 rounded-2xl p-3 text-sm flex items-center justify-between gap-2">
            <span>📅 Es 25 o más tarde — actualizá el ingreso del mes.</span>
          </div>
        )}

        <MonthSummary
          mk={currentMK}
          currency={currency}
          ingreso={ingreso}
          transactions={monthTx}
          incomeMovements={(data.incomeMovements || []).filter((m) => m.monthKey === currentMK && m.currency === currency)}
          onAddIncome={addIncomeMovement}
          onDeleteIncome={deleteIncomeMovement}
          defaultOpen="gasto"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña: Próximos meses (gastos ya comprometidos por crédito)       */
/* ------------------------------------------------------------------ */

function ProximosMesesTab({ data, currency, setCurrency, addIncomeMovement, deleteIncomeMovement, setCierreDay }) {
  const now = new Date();
  const [editingCierre, setEditingCierre] = useState(false);
  const [cierreInput, setCierreInput] = useState(String(data.config.cierreDay));

  const upcomingMonths = [1, 2].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const mk = monthKey(d);
    const monthTx = data.transactions.filter((t) => t.currency === currency && t.chargeMonth === mk);
    const ingresoMes = data.income[`${mk}:${currency}`]?.amount || 0;
    return { mk, monthTx, ingresoMes };
  });

  function saveCierre() {
    const d = parseInt(cierreInput, 10);
    if (!d || d < 1 || d > 31) return;
    setCierreDay(d);
    setEditingCierre(false);
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto h-full">
      <CountryToggle currency={currency} setCurrency={setCurrency} />
      <div className="px-4 pb-4 flex flex-col gap-4">
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
            currency={currency}
            ingreso={m.ingresoMes}
            transactions={m.monthTx}
            incomeMovements={(data.incomeMovements || []).filter((mv) => mv.monthKey === m.mk && mv.currency === currency)}
            onAddIncome={addIncomeMovement}
            onDeleteIncome={deleteIncomeMovement}
            defaultOpen="gasto"
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña 4: Historial                                                 */
/* ------------------------------------------------------------------ */

function HistorialTab({ data, currency, setCurrency, deleteTransaction }) {
  const currentMK = monthKey(new Date());
  const filteredByCurrency = data.transactions.filter((t) => t.currency === currency);
  const effMonth = (t) => t.chargeMonth || monthKey(new Date(t.ts));
  const months = Array.from(new Set([currentMK, ...filteredByCurrency.map(effMonth)])).sort().reverse();
  const [filter, setFilter] = useState(currentMK);
  const [confirmId, setConfirmId] = useState(null);

  const filtered = filteredByCurrency
    .filter((t) => effMonth(t) === filter)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  function exportCSV() {
    const header = ["Fecha", "Hora", "Categoria", "Subcategoria", "Detalle", "Concepto", "Importe", "Moneda", "MetodoPago", "MesDeCargo", "Latitud", "Longitud"];
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
          t.currency || "CHF",
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

  const groups = {};
  filtered.forEach((t) => {
    const currentName = CAT_BY_KEY[t.categoryKey]?.label || t.category;
    if (!groups[t.categoryKey]) groups[t.categoryKey] = { name: currentName, color: t.categoryColor, items: [], total: 0 };
    groups[t.categoryKey].items.push(t);
    groups[t.categoryKey].total += t.amount;
  });
  const groupList = Object.entries(groups)
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full">
      <CountryToggle currency={currency} setCurrency={setCurrency} />
      <div className="px-4 pb-4 flex flex-col gap-3">
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

      <div className="flex flex-col gap-4">
        {groupList.map((g) => (
          <div key={g.key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                {g.name}
              </span>
              <span className="text-sm font-bold text-slate-700">{fmt(g.total, currency)}</span>
            </div>
            <div className="flex flex-col gap-2">
              {g.items
                .sort((a, b) => new Date(b.ts) - new Date(a.ts))
                .map((t) => {
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
                          {[t.subcategory, t.detail].filter(Boolean).join(" › ") || CAT_BY_KEY[t.categoryKey]?.label || t.category}
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
                      <div className="text-sm font-bold text-slate-700 whitespace-nowrap">{fmt(t.amount, t.currency)}</div>
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
        ))}
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña: Ahorro (teclado directo, admite negativos = devoluciones)  */
/* ------------------------------------------------------------------ */

function AhorroTab({ data, addSavingsMovement, deleteSavingsMovement }) {
  const [amount, setAmount] = useState("0");
  const [concept, setConcept] = useState("");
  const [purposeMode, setPurposeMode] = useState("disponible"); // disponible | reservado
  const [customPurpose, setCustomPurpose] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const total = data.savings.reduce((s, m) => s + m.amount, 0);

  // Desglose: cuánto está reservado para qué, dentro del acumulado.
  const byPurpose = {};
  data.savings.forEach((m) => {
    const key = m.purpose || "Disponible";
    byPurpose[key] = (byPurpose[key] || 0) + m.amount;
  });
  const purposeRows = Object.entries(byPurpose).sort((a, b) => b[1] - a[1]);

  function purposeValue() {
    if (purposeMode === "reservado") return customPurpose.trim() || "Reservado";
    return null;
  }

  function handleSave() {
    const n = parseFloat(amount);
    if (!n) return;
    setSaving(true);
    addSavingsMovement({
      id: uid(),
      ts: new Date().toISOString(),
      amount: n,
      concept: concept.trim() || null,
      purpose: purposeValue(),
    });
    setSaving(false);
    setToast("Guardado ✅");
    setAmount("0");
    setConcept("");
    setPurposeMode("disponible");
    setCustomPurpose("");
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6 h-full overflow-y-auto">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2 rounded-full text-sm shadow-lg z-50">
          {toast}
        </div>
      )}

      <div className="bg-emerald-50 rounded-2xl px-6 py-5 text-center w-full">
        <img src="icon-ahorro.png" alt="" className="w-24 h-24 object-contain mx-auto mb-2" />
        <div className="text-sm text-emerald-700 font-medium">Ahorro acumulado</div>
        <div className="text-4xl font-bold text-emerald-800 mt-1">{fmt(total)}</div>
        {purposeRows.length > 0 && (
          <div className="mt-3 pt-3 border-t border-emerald-100 flex flex-col gap-1">
            {purposeRows.map(([label, val]) => (
              <div key={label} className="flex items-center justify-between text-sm text-emerald-700">
                <span className="truncate pr-2">{label}</span>
                <span className="font-semibold whitespace-nowrap">{fmt(val)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`text-xl font-bold tabular-nums ${amount.startsWith("-") ? "text-rose-600" : "text-emerald-700"}`}>
        {CURRENCY} {amount}
      </div>
      <Keypad value={amount} onChange={setAmount} />
      <input
        value={concept}
        onChange={(e) => setConcept(e.target.value)}
        placeholder="Concepto (opcional)"
        className="w-full max-w-xs border-2 border-slate-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-slate-400"
      />

      <div className="w-full max-w-xs grid grid-cols-2 gap-2">
        <button
          onClick={() => setPurposeMode("disponible")}
          className={`rounded-xl py-2.5 text-sm font-semibold ${purposeMode === "disponible" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}
        >
          Disponible
        </button>
        <button
          onClick={() => setPurposeMode("reservado")}
          className={`rounded-xl py-2.5 text-sm font-semibold ${purposeMode === "reservado" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}
        >
          🎯 Reservado
        </button>
      </div>
      {purposeMode === "reservado" && (
        <input
          value={customPurpose}
          onChange={(e) => setCustomPurpose(e.target.value)}
          placeholder="¿Para qué? (ej: Préstamos)"
          className="w-full max-w-xs border-2 border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-slate-400"
        />
      )}

      <button
        onClick={handleSave}
        disabled={saving || !parseFloat(amount)}
        className="w-full max-w-xs rounded-2xl py-4 text-white font-bold text-lg bg-emerald-600 disabled:opacity-40 active:scale-95 transition-transform"
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>

      <div className="w-full flex flex-col gap-2 mt-2">
        {data.savings.slice(0, 20).map((m) => {
          const d = new Date(m.ts);
          return (
            <div key={m.id} className="bg-white border border-slate-100 rounded-xl p-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500 truncate">
                  {m.concept ? `${m.concept} · ` : ""}{d.toLocaleDateString("es-AR")}
                  {m.purpose ? ` · 🎯 ${m.purpose}` : ""}
                </div>
              </div>
              <div className={`text-sm font-bold whitespace-nowrap ${m.amount >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {m.amount >= 0 ? "+" : ""}{fmt(m.amount)}
              </div>
              {confirmId === m.id ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { deleteSavingsMovement(m.id); setConfirmId(null); }}
                    className="text-xs font-bold text-white bg-rose-500 rounded-lg px-2 py-1.5"
                  >
                    Borrar
                  </button>
                  <button onClick={() => setConfirmId(null)} className="text-xs text-slate-400 px-1.5">Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(m.id)} className="text-slate-300 active:text-rose-500 px-1">✕</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña: Patrimonio (bienes, deudas, neto por país + consolidado)   */
/* ------------------------------------------------------------------ */

const ASSET_TYPES = {
  terreno: { emoji: "🌳", label: "Terreno" },
  casa: { emoji: "🏠", label: "Casa (Procrear)" },
  auto: { emoji: "🚗", label: "Auto" },
};

function PatrimonioTab({ data, saveAsset, deleteAsset }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("casa");
  const [value, setValue] = useState("");
  const [debt, setDebt] = useState("");
  const [confirmId, setConfirmId] = useState(null);

  function startNew() {
    setEditingId(null);
    setName("");
    setType("casa");
    setValue("");
    setDebt("");
    setShowForm(true);
  }

  function startEdit(a) {
    setEditingId(a.id);
    setName(a.name);
    setType(a.type);
    setValue(String(a.value));
    setDebt(String(a.debt || 0));
    setShowForm(true);
  }

  function save() {
    const v = parseFloat(value);
    if (!name.trim() || !v) return;
    saveAsset({
      id: editingId || uid(),
      name: name.trim(),
      type,
      currency: "USD",
      value: v,
      debt: parseFloat(debt) || 0,
    });
    setShowForm(false);
  }

  const netTotal = data.assets.reduce((s, a) => s + (a.value - (a.debt || 0)), 0);

  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="bg-sky-50 rounded-2xl p-4 text-center">
        <div className="text-xs text-sky-700 font-medium">💵 Patrimonio neto (USD)</div>
        <div className="text-2xl font-bold text-sky-800">{fmt(netTotal, "USD")}</div>
      </div>

      {!showForm ? (
        <button onClick={startNew} className="bg-slate-800 text-white rounded-xl py-2.5 text-sm font-semibold">
          ➕ Agregar bien
        </button>
      ) : (
        <div className="bg-slate-50 rounded-2xl p-4 flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (ej: Depto Zúrich)"
            className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(ASSET_TYPES).map(([k, m]) => (
              <button
                key={k}
                onClick={() => setType(k)}
                className={`rounded-xl py-2 text-xs font-semibold ${
                  type === k ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"
                }`}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">Valor (USD)</label>
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Deuda (opcional)</label>
              <input
                type="number"
                value={debt}
                onChange={(e) => setDebt(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-xl py-2.5 text-sm font-semibold text-slate-500 bg-slate-200">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={!name.trim() || !parseFloat(value)}
              className="rounded-xl py-2.5 text-sm font-semibold text-white bg-emerald-500 disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {data.assets.map((a) => {
          const net = a.value - (a.debt || 0);
          return (
            <div key={a.id} className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">
                {ASSET_TYPES[a.type]?.emoji || "📦"}
              </div>
              <button className="flex-1 min-w-0 text-left" onClick={() => startEdit(a)}>
                <div className="text-sm font-semibold text-slate-800 truncate">{a.name}</div>
                <div className="text-xs text-slate-400">
                  Valor {fmt(a.value, "USD")}{a.debt ? ` · Deuda ${fmt(a.debt, "USD")}` : ""}
                </div>
              </button>
              <div className="text-sm font-bold text-slate-700 whitespace-nowrap">{fmt(net, "USD")}</div>
              {confirmId === a.id ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { deleteAsset(a.id); setConfirmId(null); }}
                    className="text-xs font-bold text-white bg-rose-500 rounded-lg px-2 py-1.5"
                  >
                    Borrar
                  </button>
                  <button onClick={() => setConfirmId(null)} className="text-xs text-slate-400 px-1.5">Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(a.id)} className="text-slate-300 active:text-rose-500 text-lg px-1">✕</button>
              )}
            </div>
          );
        })}
        {data.assets.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">Todavía no cargaste ningún bien.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pestaña: Compras/Proyectos (prueba simple)                          */
/* ------------------------------------------------------------------ */

function ProyectosTab({ data, saveProyecto, deleteProyecto }) {
  const [addingType, setAddingType] = useState(null); // null | "compra" | "proyecto"
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [pcurrency, setPCurrency] = useState("CHF");
  const [items, setItems] = useState([]);
  const [amount, setAmount] = useState("0"); // usado en modo "compra"
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("0");
  const [confirmId, setConfirmId] = useState(null);

  const [showTransfer, setShowTransfer] = useState(false);
  const [transferAmount, setTransferAmount] = useState("0");
  const [transferOrigin, setTransferOrigin] = useState("CHF");
  const [transferTarget, setTransferTarget] = useState("CHF");
  const [transferRate, setTransferRate] = useState("1837");
  const [transfers, setTransfers] = useState([]); // {id, origin, target, amount, rate, finalAmount}
  const [confirmTransferId, setConfirmTransferId] = useState(null);

  const now = new Date();
  const currentMK = monthKey(now);
  const effMonth = (t) => t.chargeMonth || monthKey(new Date(t.ts));

  function excedenteReal(cur) {
    const gasto = data.transactions
      .filter((t) => t.currency === cur && effMonth(t) === currentMK)
      .reduce((s, t) => s + t.amount, 0);
    const ingreso = data.income[`${currentMK}:${cur}`]?.amount || 0;
    return ingreso - gasto;
  }
  const proyectos = data.proyectos || [];
  const totalGuardado = (cur) =>
    proyectos.filter((p) => p.currency === cur).reduce((s, p) => s + (p.items || []).reduce((s2, i) => s2 + i.price, 0), 0);

  // Los totales ya guardados (compras/proyectos) y las transferencias desde
  // Ahorro impactan en vivo sobre el excedente mostrado — es una vista de
  // planificación, no mueve plata real entre pestañas.
  const transferCHF = transfers.filter((t) => t.target === "CHF").reduce((s, t) => s + t.finalAmount, 0);
  const transferARS = transfers.filter((t) => t.target === "ARS").reduce((s, t) => s + t.finalAmount, 0);
  const transferredFromAhorro = transfers.reduce((s, t) => s + t.amount, 0);

  const excedenteCHF = excedenteReal("CHF") - totalGuardado("CHF") + transferCHF;
  const excedenteARS = excedenteReal("ARS") - totalGuardado("ARS") + transferARS;
  const disponible = data.savings.filter((m) => !m.purpose).reduce((s, m) => s + m.amount, 0) - transferredFromAhorro;

  function startNew(type) {
    setEditingId(null);
    setName("");
    setPCurrency("CHF");
    setItems([]);
    setAmount("0");
    setItemName("");
    setItemPrice("0");
    setAddingType(type);
  }

  function startEdit(p) {
    setEditingId(p.id);
    setName(p.name);
    setPCurrency(p.currency);
    setItems(p.items || []);
    setAmount(p.items && p.items[0] ? String(p.items[0].price) : "0");
    setAddingType(p.type);
  }

  function addItem() {
    if (!itemName.trim() || !parseFloat(itemPrice)) return;
    setItems([...items, { id: uid(), name: itemName.trim(), price: parseFloat(itemPrice) }]);
    setItemName("");
    setItemPrice("0");
  }

  function removeItem(id) {
    setItems(items.filter((i) => i.id !== id));
  }

  function saveCompra() {
    if (!name.trim() || !parseFloat(amount)) return;
    saveProyecto({
      id: editingId || uid(),
      name: name.trim(),
      type: "compra",
      currency: pcurrency,
      items: [{ id: uid(), name: name.trim(), price: parseFloat(amount) }],
    });
    setAddingType(null);
  }

  function saveProyectoMulti() {
    if (!name.trim() || items.length === 0) return;
    saveProyecto({ id: editingId || uid(), name: name.trim(), type: "proyecto", currency: pcurrency, items });
    setAddingType(null);
  }

  const needsRate = transferOrigin !== transferTarget;

  function doTransfer() {
    const n = parseFloat(transferAmount);
    if (!n) return;
    const rate = parseFloat(transferRate);
    const finalAmount = needsRate ? (rate ? n * rate : 0) : n;
    if (!finalAmount) return;
    setTransfers([
      { id: uid(), origin: transferOrigin, target: transferTarget, amount: n, rate: needsRate ? rate : null, finalAmount },
      ...transfers,
    ]);
    setTransferAmount("0");
    setShowTransfer(false);
  }

  function undoTransfer(id) {
    setTransfers(transfers.filter((t) => t.id !== id));
    setConfirmTransferId(null);
  }

  const totalProyecto = items.reduce((s, i) => s + i.price, 0);

  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto h-full">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-sky-50 rounded-2xl p-3 text-center">
          <div className="text-xs text-sky-700 font-medium">Excedente CHF (mes)</div>
          <div className="text-sm font-bold text-sky-800">{fmt(excedenteCHF, "CHF")}</div>
        </div>
        <div className="bg-amber-50 rounded-2xl p-3 text-center">
          <div className="text-xs text-amber-700 font-medium">Excedente ARS (mes)</div>
          <div className="text-sm font-bold text-amber-800">{fmt(excedenteARS, "ARS")}</div>
        </div>
      </div>

      <button
        onClick={() => setShowTransfer((v) => !v)}
        className="bg-emerald-50 rounded-2xl p-3 text-center active:bg-emerald-100"
      >
        <div className="text-xs text-emerald-700 font-medium">🐷 Ahorro disponible (tocá para transferir)</div>
        <div className="text-sm font-bold text-emerald-800">{fmt(disponible)}</div>
      </button>

      {showTransfer && (
        <div className="bg-slate-50 rounded-2xl p-3 flex flex-col gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Origen (cómo pensás este monto)</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTransferOrigin("CHF")}
                className={`rounded-xl py-2 text-sm font-semibold ${transferOrigin === "CHF" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
              >
                🇨🇭 CHF
              </button>
              <button
                onClick={() => setTransferOrigin("ARS")}
                className={`rounded-xl py-2 text-sm font-semibold ${transferOrigin === "ARS" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
              >
                🇦🇷 ARS
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1">Destino</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTransferTarget("CHF")}
                className={`rounded-xl py-2 text-sm font-semibold ${transferTarget === "CHF" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
              >
                🇨🇭 Excedente CHF
              </button>
              <button
                onClick={() => setTransferTarget("ARS")}
                className={`rounded-xl py-2 text-sm font-semibold ${transferTarget === "ARS" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
              >
                🇦🇷 Excedente ARS
              </button>
            </div>
          </div>

          <div className="text-2xl font-bold text-center tabular-nums text-slate-800">{transferOrigin} {transferAmount}</div>
          <Keypad value={transferAmount} onChange={setTransferAmount} />

          {needsRate ? (
            <div>
              <label className="text-xs text-slate-500">Tasa de cambio (1 {transferOrigin} = ? {transferTarget})</label>
              <input
                type="number"
                value={transferRate}
                onChange={(e) => setTransferRate(e.target.value)}
                placeholder="Ej: 1200"
                className="w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <p className="text-[10px] text-slate-400 text-center">Origen y destino son la misma moneda — no hace falta convertir.</p>
          )}

          {needsRate && parseFloat(transferRate) > 0 && parseFloat(transferAmount) > 0 && (
            <div className="text-xs text-slate-500 text-center">
              Equivale a {fmt(parseFloat(transferAmount) * parseFloat(transferRate), transferTarget)}
            </div>
          )}

          <button
            onClick={doTransfer}
            disabled={!parseFloat(transferAmount) || (needsRate && !parseFloat(transferRate))}
            className="rounded-xl py-2.5 text-sm font-semibold text-white bg-emerald-500 disabled:opacity-40"
          >
            Transferir
          </button>
          <p className="text-[10px] text-slate-400">Esto solo ajusta la vista de esta pestaña, no mueve plata real de Ahorro.</p>
        </div>
      )}

      {transfers.length > 0 && (
        <div className="flex flex-col gap-2">
          {transfers.map((t) => (
            <div key={t.id} className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">🔁</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">
                  {t.origin} {fmt(t.amount, t.origin)} → {t.target} {fmt(t.finalAmount, t.target)}
                </div>
                <div className="text-xs text-slate-400">{t.rate ? `Tasa: 1 ${t.origin} = ${t.rate} ${t.target}` : "Sin conversión"}</div>
              </div>
              {confirmTransferId === t.id ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => undoTransfer(t.id)}
                    className="text-xs font-bold text-white bg-rose-500 rounded-lg px-2 py-1.5"
                  >
                    Deshacer
                  </button>
                  <button onClick={() => setConfirmTransferId(null)} className="text-xs text-slate-400 px-1.5">Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setConfirmTransferId(t.id)} className="text-slate-300 active:text-rose-500 text-lg px-1">✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {addingType === null ? (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => startNew("compra")} className="bg-slate-800 text-white rounded-xl py-3 text-sm font-semibold">
            🛍️ Compra
          </button>
          <button onClick={() => startNew("proyecto")} className="bg-slate-800 text-white rounded-xl py-3 text-sm font-semibold">
            🏗️ Proyecto
          </button>
        </div>
      ) : addingType === "compra" ? (
        <div className="bg-slate-50 rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-slate-700">🛍️ Compra</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Dron, aspiradora"
            className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPCurrency("CHF")}
              className={`rounded-xl py-2 text-sm font-semibold ${pcurrency === "CHF" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
            >
              🇨🇭 CHF
            </button>
            <button
              onClick={() => setPCurrency("ARS")}
              className={`rounded-xl py-2 text-sm font-semibold ${pcurrency === "ARS" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
            >
              🇦🇷 ARS
            </button>
          </div>
          <div className="text-2xl font-bold text-center tabular-nums text-slate-800">{pcurrency} {amount}</div>
          <Keypad value={amount} onChange={setAmount} />

          {parseFloat(amount) > 0 && (
            <div className="text-xs text-slate-500 text-center">
              Excedente {pcurrency}: {fmt(pcurrency === "CHF" ? excedenteCHF : excedenteARS, pcurrency)} → quedaría en{" "}
              <span className={(pcurrency === "CHF" ? excedenteCHF : excedenteARS) - parseFloat(amount) >= 0 ? "text-sky-600 font-semibold" : "text-rose-600 font-semibold"}>
                {fmt((pcurrency === "CHF" ? excedenteCHF : excedenteARS) - parseFloat(amount), pcurrency)}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setAddingType(null)} className="rounded-xl py-2.5 text-sm font-semibold text-slate-500 bg-slate-200">
              Cancelar
            </button>
            <button
              onClick={saveCompra}
              disabled={!name.trim() || !parseFloat(amount)}
              className="rounded-xl py-2.5 text-sm font-semibold text-white bg-emerald-500 disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-slate-700">🏗️ Proyecto</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Galería del patio"
            className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPCurrency("CHF")}
              className={`rounded-xl py-2 text-sm font-semibold ${pcurrency === "CHF" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
            >
              🇨🇭 CHF
            </button>
            <button
              onClick={() => setPCurrency("ARS")}
              className={`rounded-xl py-2 text-sm font-semibold ${pcurrency === "ARS" ? "bg-slate-800 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
            >
              🇦🇷 ARS
            </button>
          </div>

          {items.length > 0 && (
            <div className="flex flex-col gap-2">
              {items.map((i) => (
                <div key={i.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm">
                  <span className="truncate pr-2">{i.name}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-semibold">{fmt(i.price, pcurrency)}</span>
                    <button onClick={() => removeItem(i.id)} className="text-slate-300 active:text-rose-500">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <input
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="Ítem (ej: Materiales, Mano de obra)"
            className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <div className="text-2xl font-bold text-center tabular-nums text-slate-800">{pcurrency} {itemPrice}</div>
          <Keypad value={itemPrice} onChange={setItemPrice} />
          <button
            onClick={addItem}
            disabled={!itemName.trim() || !parseFloat(itemPrice)}
            className="rounded-xl py-2.5 text-sm font-semibold text-white bg-sky-600 disabled:opacity-40"
          >
            + Agregar ítem
          </button>

          <div className="bg-white rounded-xl p-3 text-center border border-slate-200">
            <div className="text-xs text-slate-500">Total estimado</div>
            <div className="text-xl font-bold text-slate-800">{fmt(totalProyecto, pcurrency)}</div>
          </div>

          {totalProyecto > 0 && (
            <div className="text-xs text-slate-500 text-center">
              Excedente {pcurrency}: {fmt(pcurrency === "CHF" ? excedenteCHF : excedenteARS, pcurrency)} → quedaría en{" "}
              <span className={(pcurrency === "CHF" ? excedenteCHF : excedenteARS) - totalProyecto >= 0 ? "text-sky-600 font-semibold" : "text-rose-600 font-semibold"}>
                {fmt((pcurrency === "CHF" ? excedenteCHF : excedenteARS) - totalProyecto, pcurrency)}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setAddingType(null)} className="rounded-xl py-2.5 text-sm font-semibold text-slate-500 bg-slate-200">
              Cancelar
            </button>
            <button
              onClick={saveProyectoMulti}
              disabled={!name.trim() || items.length === 0}
              className="rounded-xl py-2.5 text-sm font-semibold text-white bg-emerald-500 disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {proyectos.map((p) => {
          const t = (p.items || []).reduce((s, i) => s + i.price, 0);
          return (
            <div key={p.id} className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">
                {p.type === "compra" ? "🛍️" : "🏗️"}
              </div>
              <button className="flex-1 min-w-0 text-left" onClick={() => startEdit(p)}>
                <div className="text-sm font-semibold text-slate-800 truncate">{p.name}</div>
                <div className="text-xs text-slate-400">
                  {p.type === "compra" ? "Compra" : `Proyecto · ${(p.items || []).length} ítem(s)`}
                </div>
              </button>
              <div className="text-sm font-bold text-slate-700 whitespace-nowrap">{fmt(t, p.currency)}</div>
              {confirmId === p.id ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { deleteProyecto(p.id); setConfirmId(null); }}
                    className="text-xs font-bold text-white bg-rose-500 rounded-lg px-2 py-1.5"
                  >
                    Borrar
                  </button>
                  <button onClick={() => setConfirmId(null)} className="text-xs text-slate-400 px-1.5">Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(p.id)} className="text-slate-300 active:text-rose-500 text-lg px-1">✕</button>
              )}
            </div>
          );
        })}
        {proyectos.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">Todavía no cargaste ninguna compra o proyecto.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

function App() {
  const {
    data, ready, saveError, refresh, addTransaction, deleteTransaction, addIncomeMovement, deleteIncomeMovement,
    setCierreDay, setFxRate, setDailyEstimate, setHiddenLoans, saveAsset, deleteAsset, addSavingsMovement, deleteSavingsMovement,
    saveProyecto, deleteProyecto,
  } = useSharedData();
  const [tab, setTab] = useState("entry");
  const [viewCurrency, setViewCurrency] = useState("CHF");

  useEffect(() => {
    if (tab !== "entry") refresh();
  }, [tab, refresh]);

  const tabs = [
    { key: "entry", label: "Cargar", emoji: "➕" },
    { key: "balance", label: "Balance mensual", emoji: "📊" },
    { key: "proximos", label: "Próximos meses", emoji: "📅" },
    { key: "ahorro", label: "Ahorro", emoji: "🐷", icon: "icon-ahorro.png" },
    { key: "patrimonio", label: "Patrimonio", emoji: "🏛️" },
    { key: "proyectos", label: "Compras/\nProyectos", emoji: "🛍️" },
    { key: "historial", label: "Historial", emoji: "🧾" },
  ];

  return (
    <div className="w-full h-[100dvh] bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between pt-safe">
        <span className="flex items-center gap-2 font-bold">
          <img src="apple-touch-icon.png" alt="" className="w-7 h-7 rounded-lg" />
          Mango
        </span>
        <div className="flex items-center gap-3">
          {saveError && <span className="text-[10px] text-amber-300">⚠ sin conexión al Sheet</span>}
          {tab !== "entry" && (
            <button onClick={refresh} className="text-xs text-slate-300 active:text-white">↻</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {!ready ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">Cargando…</div>
        ) : tab === "entry" ? (
          <EntryTab addTransaction={addTransaction} config={data.config} data={data} setHiddenLoans={setHiddenLoans} setFxRate={setFxRate} setDailyEstimate={setDailyEstimate} />
        ) : tab === "balance" ? (
          <BalanceTab data={data} currency={viewCurrency} setCurrency={setViewCurrency} addIncomeMovement={addIncomeMovement} deleteIncomeMovement={deleteIncomeMovement} />
        ) : tab === "proximos" ? (
          <ProximosMesesTab data={data} currency={viewCurrency} setCurrency={setViewCurrency} addIncomeMovement={addIncomeMovement} deleteIncomeMovement={deleteIncomeMovement} setCierreDay={setCierreDay} />
        ) : tab === "ahorro" ? (
          <AhorroTab data={data} addSavingsMovement={addSavingsMovement} deleteSavingsMovement={deleteSavingsMovement} />
        ) : tab === "patrimonio" ? (
          <PatrimonioTab data={data} saveAsset={saveAsset} deleteAsset={deleteAsset} />
        ) : tab === "proyectos" ? (
          <ProyectosTab data={data} saveProyecto={saveProyecto} deleteProyecto={deleteProyecto} />
        ) : (
          <HistorialTab data={data} currency={viewCurrency} setCurrency={setViewCurrency} deleteTransaction={deleteTransaction} />
        )}
      </div>

      <div className="grid grid-cols-7 border-t border-slate-200 bg-white pb-safe">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-2.5 flex flex-col items-center gap-0.5 text-[8.5px] leading-tight font-medium px-0.5 text-center ${
              tab === t.key ? "text-slate-900" : "text-slate-400"
            }`}
          >
            {t.icon ? (
              <img src={t.icon} alt="" className="w-5 h-5 object-contain rounded" />
            ) : (
              <span className="text-base">{t.emoji}</span>
            )}
            <span style={{ whiteSpace: "pre-line" }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
