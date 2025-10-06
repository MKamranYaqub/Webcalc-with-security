/* eslint-disable no-unused-vars */
const { useState, useMemo, useCallback } = React;

/* --------------------------------- UI Bits --------------------------------- */
function SectionTitle({ children }) {
  return (
    <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "#334155",
          textTransform: "normal",
          letterSpacing: "0.04em",
          marginTop: 8,
          marginBottom: 4,
        }}
      >
        {children}
      </div>
      <div style={{ height: 1, background: "#e2e8f0", marginBottom: 8 }} />
    </div>
  );
}

// Reusable Slider
function SliderInput({ label, min, max, step, value, onChange, formatValue, style }) {
  return (
    <div style={{ margin: "10px 0", ...style }}>
      {label != null && (
        <label style={{ display: 'block', fontSize: 12, color: '#475569', marginBottom: 4 }}>
          {label}: <b>{formatValue(value)}</b>
        </label>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

/* ----------------------------- GLOBAL CONSTANTS ---------------------------- */
const MAX_ROLLED_MONTHS = window.MAX_ROLLED_MONTHS ?? 9;
const MAX_DEFERRED_FIX = window.MAX_DEFERRED_FIX ?? 0.0125;
const MAX_DEFERRED_TRACKER = window.MAX_DEFERRED_TRACKER ?? 0.02;
const SHOW_FEE_COLS = window.SHOW_FEE_COLS ?? ["6", "4", "3", "2"];


/* ------------------------------ UTIL FUNCTIONS ----------------------------- */
const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmtMoney0 = (n) =>
  n || n === 0
    ? Number(n).toLocaleString("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      })
    : "—";
const fmtPct = (p, dp = 2) =>
  p || p === 0 ? `${(Number(p) * 100).toFixed(dp)}%` : "—";
const parsePct = (s) => {
  const v = String(s).trim().replace(/%/g, '');
  const n = Number(v) / 100;
  return Number.isFinite(n) ? n : null;
};

/* Tier/LTV rule */
function getMaxLTV(tier, flatAboveComm) {
  if (flatAboveComm === "Yes") {
    if (tier === "Tier 2") return 0.60;
    if (tier === "Tier 3") return 0.70;
  }
  return 0.75;
}
function formatRevertRate(tier) {
  const add = window.REVERT_RATE?.[tier]?.add ?? 0;
  return add === 0 ? "MVR" : `MVR + ${(add * 100).toFixed(2)}%`;
}
function formatERC(productType) {
  const ercArr = window.ERC?.[productType] ?? ["—"];
  return ercArr.join(" / ");
}

/* ----------------------------------- App ----------------------------------- */
function App() {
  /* ---------------------------- Criteria (Dynamic) --------------------------- */
  // Build default answers = first option of each question
  const initialCriteria = useMemo(() => {
    const cfg = window.CRITERIA_CONFIG || {};
    const blocks = [
      ...(cfg.propertyQuestions || []),
      ...(cfg.applicantQuestions || []),
      ...(cfg.adverseQuestions || []),
    ];
    const entries = blocks.map(q => {
      const first =
        (Array.isArray(q.options) && q.options.length
          ? (typeof q.options[0] === 'string' ? q.options[0] : q.options[0].label)
          : "");
      return [q.key, first];
    });
    return Object.fromEntries(entries);
  }, []);

  const [criteria, setCriteria] = useState(initialCriteria);

  const handleCriteriaChange = (key, value) => {
    setCriteria(prev => ({ ...prev, [key]: value }));
  };

  const flatAboveCommVal = criteria.flatAboveComm || "No";

  /* ------------------------------ Product/Inputs ---------------------------- */
  const [productType, setProductType] = useState("2yr Fix");

  const [loanTypeRequired, setLoanTypeRequired] = useState("Max Optimum Gross Loan");
  const [specificNetLoan, setSpecificNetLoan] = useState("");
  const [specificLTV, setSpecificLTV] = useState(0.75);

  // Manual & rate override
  const [manualSettings, setManualSettings] = useState({});
  const [rateOverrides, setRateOverrides] = useState({});
  const [tempRateInput, setTempRateInput] = useState({});

  // Client / Lead
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);

  // Property & income
  const [propertyValue, setPropertyValue] = useState("1000000");
  const [monthlyRent, setMonthlyRent] = useState("3000");

  const [validationError, setValidationError] = useState("");

  const cleanDigits = (v) => String(v).replace(/[^\d]/g, "");

  /* --------------------------- Tier (Dynamic rules) -------------------------- */
  const tier = useMemo(() => {
    const cfg = window.CRITERIA_CONFIG || {};
    const propQs = cfg.propertyQuestions || [];
    const applQs = cfg.applicantQuestions || [];
    const advQs = cfg.adverseQuestions || [];
    const advMap = cfg.tierRules?.adverseMapping || {};
    let t = 1;

    // Property + Applicant questions: use option tiers where provided
    [...propQs, ...applQs].forEach(q => {
      const val = criteria[q.key];
      // option can be string or {label,tier}
      let optTier = 1;
      if (Array.isArray(q.options)) {
        const found = q.options.find(o => (typeof o === 'string' ? o === val : o.label === val));
        if (found && typeof found !== 'string') {
          optTier = Number(found.tier || 1);
        } else if (found && typeof found === 'string') {
          // e.g. "Yes"/"No" without explicit tier
          // default 1 unless special-case; your config sets tiers for all that need it
          optTier = 1;
        }
      }
      t = Math.max(t, optTier);
    });

    // Flat above commercial minimum tier
    if (criteria.flatAboveComm === "Yes") {
      t = Math.max(t, cfg.tierRules?.flatAboveCommMinimum || 1);
    }

    // Adverse follow-ups only apply when adverse === "Yes"
    if (criteria.adverse === "Yes") {
      const aTier = Math.max(
        advMap.mortArrears?.[criteria.mortArrears] || 1,
        advMap.unsArrears?.[criteria.unsArrears] || 1,
        advMap.ccjDefault?.[criteria.ccjDefault] || 1,
        advMap.bankruptcy?.[criteria.bankruptcy] || 1
      );
      t = Math.max(t, aTier);
    }

    return t === 1 ? "Tier 1" : t === 2 ? "Tier 2" : "Tier 3";
  }, [criteria]);

  /* --------------------------- External constants --------------------------- */
  const selected = window.RATES?.[tier]?.products?.[productType];
  const isTracker = !!selected?.isMargin;

  const MIN_ICR_FIX = window.MIN_ICR?.Fix ?? 1.25;
  const MIN_ICR_TRK = window.MIN_ICR?.Tracker ?? 1.30;
  const MIN_LOAN = window.MIN_LOAN ?? 150000;
  const MAX_LOAN = window.MAX_LOAN ?? 3000000;
  const STANDARD_BBR = window.STANDARD_BBR ?? 0.04;
  const STRESS_BBR = window.STRESS_BBR ?? 0.0425;
  const TERM_MONTHS = window.TERM_MONTHS ?? {
    "2yr Fix": 24,
    "3yr Fix": 36,
    "2yr Tracker": 24,
    Tracker: 24,
  };
  const TOTAL_TERM = window.TOTAL_TERM ?? 10;
  const CURRENT_MVR = window.CURRENT_MVR;

  /* ------------------------------ Calculations ----------------------------- */
  const canShowMatrix = useMemo(() => {
    const mr = toNumber(monthlyRent);
    const pv = toNumber(propertyValue);
    const sn = toNumber(specificNetLoan);

    if (!mr) return false;
    if (loanTypeRequired === "Specific Net Loan") return !!sn && !!pv;
    if (loanTypeRequired === "Maximum LTV Loan") return !!pv;
    return !!pv;
  }, [monthlyRent, propertyValue, specificNetLoan, specificLTV, loanTypeRequired]);

  const computeForCol = useCallback((colKey, manualRolled, manualDeferred, overriddenRate) => {
    const base = selected?.[colKey];
    if (base == null && !overriddenRate) return null;

    const pv = toNumber(propertyValue);
    const mr = toNumber(monthlyRent);
    const sn = toNumber(specificNetLoan);
    const feePct = Number(colKey) / 100;

    const minICR = productType.includes("Fix") ? MIN_ICR_FIX : MIN_ICR_TRK;
    const maxLTVRule = getMaxLTV(tier, flatAboveCommVal);

    const grossLTVRuleCap = pv ? pv * maxLTVRule : Infinity;

    const specificLTVCap =
      loanTypeRequired === "Maximum LTV Loan" && specificLTV != null
        ? pv * specificLTV
        : Infinity;

    const ltvCap =
      loanTypeRequired === "Maximum LTV Loan"
        ? Math.min(specificLTVCap, grossLTVRuleCap)
        : grossLTVRuleCap;

    const termMonths = TERM_MONTHS[productType] ?? 24;

    const deferredCap = isTracker ? MAX_DEFERRED_TRACKER : MAX_DEFERRED_FIX;

    const actualBaseRate = overriddenRate != null ? overriddenRate : base;

    const displayRate = isTracker ? actualBaseRate + STANDARD_BBR : actualBaseRate;
    const stressRate = isTracker ? actualBaseRate + STRESS_BBR : displayRate;

    const isRateOverridden = overriddenRate != null;

    const evalCombo = (rolledMonths, d) => {
      const monthsLeft = Math.max(termMonths - rolledMonths, 1);
      const stressAdj = Math.max(stressRate - d, 1e-6);

      let grossRent = Infinity;
      if (mr && stressAdj > 0) {
        const annualRent = mr * termMonths;
        grossRent = annualRent / (minICR * (stressAdj / 12) * monthsLeft);
      }

      let grossFromNet = Infinity;
      if (loanTypeRequired === "Specific Net Loan" && sn != null && feePct < 1) {
        const denom =
          1 -
          feePct -
          ((Math.max(displayRate - d, 0)) / 12) * rolledMonths -
          (d / 12) * termMonths;
        if (denom > 0.0000001) {
          grossFromNet = sn / denom;
        }
      }

      let eligibleGross = Math.min(ltvCap, grossRent, MAX_LOAN);

      if (loanTypeRequired === "Specific Net Loan") {
        eligibleGross = Math.min(eligibleGross, grossFromNet);
      }

      if (eligibleGross < MIN_LOAN - 1e-6) eligibleGross = 0;

      const payRateAdj = Math.max(displayRate - d, 0);
      const feeAmt = eligibleGross * feePct;
      const rolledAmt = (eligibleGross * (payRateAdj / 12)) * rolledMonths;
      const deferredAmt = (eligibleGross * (d / 12)) * termMonths;
      const net = eligibleGross - feeAmt - rolledAmt - deferredAmt;
      const ltv = pv ? eligibleGross / pv : null;

      return {
        gross: eligibleGross,
        net,
        feeAmt,
        rolledAmt,
        deferredAmt,
        ltv,
        rolledMonths,
        d,
        payRateAdj,
      };
    };

    let best = null;

    if (manualRolled != null || manualDeferred != null) {
      const rolled = Number.isFinite(manualRolled) ? manualRolled : 0;
      const deferred = Number.isFinite(manualDeferred) ? manualDeferred : 0;

      const safeRolled = Math.max(0, Math.min(rolled, MAX_ROLLED_MONTHS));
      const safeDeferred = Math.max(0, Math.min(deferred, deferredCap));

      let safeBest;
      try {
        safeBest = evalCombo(safeRolled, safeDeferred);
        if (!safeBest || !isFinite(safeBest.gross)) {
          safeBest = evalCombo(0, 0);
        }
      } catch (err) {
        safeBest = evalCombo(0, 0);
      }
      best = safeBest;
    } else {
      const maxRolled = Math.min(MAX_ROLLED_MONTHS, termMonths);
      const step = 0.0001;
      const steps = Math.max(1, Math.round(deferredCap / step));

      for (let r = 0; r <= maxRolled; r += 1) {
        for (let j = 0; j <= steps; j += 1) {
          const d = j * step;
          const out = evalCombo(r, d);
          if (!best || out.net > best.net) best = out;
        }
      }
    }

    if (!best) return null;

    const fullRateText = isTracker
      ? `${(actualBaseRate * 100).toFixed(2)}% + BBR`
      : `${(displayRate * 100).toFixed(2)}%`;
    const payRateText = isTracker
      ? `${(best.payRateAdj * 100).toFixed(2)}% + BBR`
      : `${(best.payRateAdj * 100).toFixed(2)}%`;

    const belowMin = best.gross > 0 && best.gross < MIN_LOAN - 1e-6;
    const hitMaxCap = Math.abs(best.gross - MAX_LOAN) < 1e-6;

    const ddAmount = best.gross * (best.payRateAdj / 12);

    return {
      productName: `${productType}, ${tier}`,
      fullRateText,
      actualRateUsed: actualBaseRate,
      isRateOverridden,
      payRateText,
      deferredCapPct: best.d,
      net: best.net,
      gross: best.gross,
      feeAmt: best.feeAmt,
      rolled: best.rolledAmt,
      deferred: best.deferredAmt,
      ltv: best.ltv,
      rolledMonths: best.rolledMonths,
      directDebit: ddAmount,
      maxLtvRule: getMaxLTV(tier, flatAboveCommVal),
      termMonths,
      belowMin,
      hitMaxCap,
      ddStartMonth: best.rolledMonths + 1,
      isManual: manualRolled != null && manualDeferred != null
    };
  }, [
    selected, propertyValue, monthlyRent, specificNetLoan, specificLTV, loanTypeRequired,
    productType, tier, flatAboveCommVal, MIN_ICR_FIX, MIN_ICR_TRK, MIN_LOAN, MAX_LOAN,
    STANDARD_BBR, STRESS_BBR, TERM_MONTHS, isTracker
  ]);

  function computeBasicGrossForCol(colKey) {
    const base = selected?.[colKey];
    if (base == null) return null;

    const pv = toNumber(propertyValue);
    const mr = toNumber(monthlyRent);
    const sn = toNumber(specificNetLoan);
    const feePct = Number(colKey) / 100;

    const minICR = productType.includes("Fix") ? MIN_ICR_FIX : MIN_ICR_TRK;
    const maxLTVRule = getMaxLTV(tier, flatAboveCommVal);

    const grossLTVRuleCap = pv ? pv * maxLTVRule : Infinity;

    const specificLTVCap =
      loanTypeRequired === "Maximum LTV Loan" && specificLTV != null
        ? pv * specificLTV
        : Infinity;

    const ltvCap =
      loanTypeRequired === "Maximum LTV Loan"
        ? Math.min(specificLTVCap, grossLTVRuleCap)
        : grossLTVRuleCap;

    const displayRate = isTracker ? base + STANDARD_BBR : base;
    const stressRate = isTracker ? base + STRESS_BBR : displayRate;

    const deferred = 0;
    const termMonths = TERM_MONTHS[productType] ?? 24;
    const monthsLeft = termMonths;
    const stressAdj = Math.max(stressRate - deferred, 1e-6);

    let grossRent = Infinity;
    if (mr && stressAdj) {
      const annualRent = mr * termMonths;
      grossRent = annualRent / (minICR * (stressAdj / 12) * monthsLeft);
    }

    let grossFromNet = Infinity;
    if (loanTypeRequired === "Specific Net Loan" && sn != null && feePct < 1) {
      const denom = 1 - feePct;
      if (denom > 0) grossFromNet = sn / denom;
    }

    let eligibleGross = Math.min(ltvCap, grossRent, MAX_LOAN);

    if (loanTypeRequired === "Specific Net Loan") {
      eligibleGross = Math.min(eligibleGross, grossFromNet);
    }

    const ltvPct = pv ? Math.round((eligibleGross / pv) * 100) : null;

    return {
      grossBasic: eligibleGross,
      ltvPctBasic: ltvPct,
    };
  }

  const allColumnData = useMemo(() => {
    if (!canShowMatrix) return [];
    const pv = toNumber(propertyValue);

    return SHOW_FEE_COLS
      .map((colKey) => {
        const manual = manualSettings[colKey];
        const overriddenRate = rateOverrides[colKey];
        const data = computeForCol(colKey, manual?.rolledMonths, manual?.deferredPct, overriddenRate);
        if (!data) return null;
        const netLtv = pv ? data.net / pv : null;
        return { colKey, netLtv, ...data };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    productType, tier, propertyValue, monthlyRent, specificNetLoan, specificLTV,
    loanTypeRequired, flatAboveCommVal, canShowMatrix, computeForCol, manualSettings, rateOverrides
  ]);

  const bestSummary = useMemo(() => {
    if (!canShowMatrix || !allColumnData.length) return null;
    const pv = toNumber(propertyValue) || 0;

    let best = null;
    for (const d of allColumnData) {
      if (!best || d.net > best.net) {
        best = {
          colKey: d.colKey,
          gross: d.gross,
          grossStr: fmtMoney0(d.gross),
          grossLtvPct: pv ? Math.round((d.gross / pv) * 100) : 0,
          net: d.net,
          netStr: fmtMoney0(d.net),
          netLtvPct: pv ? Math.round((d.net / pv) * 100) : 0,
        };
      }
    }
    return best;
  }, [allColumnData, canShowMatrix, propertyValue]);

  /* ------------------- Rate override + manual settings handlers ------------------- */
  const handleRateInputChange = (colKey, value) => {
    setTempRateInput(prev => ({ ...prev, [colKey]: value }));
  };

  const handleRateInputBlur = (colKey, value, originalRate) => {
    setTempRateInput(prev => ({ ...prev, [colKey]: undefined }));
    const parsedRate = parsePct(value);
    if (parsedRate != null && Math.abs(parsedRate - originalRate) > 0.00001) {
      setRateOverrides(prev => ({ ...prev, [colKey]: parsedRate }));
    } else {
      setRateOverrides(prev => {
        const newState = { ...prev };
        delete newState[colKey];
        return newState;
      });
    }
  };

  const handleRolledChange = (colKey, value) => {
    setManualSettings(prev => ({
      ...prev,
      [colKey]: { ...prev[colKey], rolledMonths: value }
    }));
  };
  const handleDeferredChange = (colKey, value) => {
    setManualSettings(prev => ({
      ...prev,
      [colKey]: { ...prev[colKey], deferredPct: value }
    }));
  };
  const handleResetManual = (colKey) => {
    setManualSettings(prev => {
      const s = { ...prev };
      delete s[colKey];
      return s;
    });
  };
  const handleResetRateOverride = (colKey) => {
    setRateOverrides(prev => {
      const s = { ...prev };
      delete s[colKey];
      return s;
    });
  };

  /* --------------------------- Send Quote via Email --------------------------- */
  const handleSendQuote = async () => {
    setValidationError("");
    setSendStatus(null);

    if (!canShowMatrix || !bestSummary) {
      setValidationError("Please complete the calculation fields before sending email.");
      return;
    }
    if (!clientName.trim() || !clientPhone.trim() || !clientEmail.trim()) {
      setValidationError("Please complete all client fields before sending email.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+?\.[^\s@]+$/;
    if (!emailRegex.test(clientEmail)) {
      setValidationError("Please enter a valid email address.");
      return;
    }

    setSending(true);
    setSendStatus(null);

    try {
      const zapierWebhookUrl = "https://hooks.zapier.com/hooks/catch/10082441/uhocm7m/";

      const columnCalculations = allColumnData.map(d => ({
        feePercent: d.colKey,
        ...d
      }));

      const basicGrossCalculations = SHOW_FEE_COLS
        .map((k) => {
          const d = computeBasicGrossForCol(k);
          return d ? { feePercent: k, ...d } : null;
        })
        .filter(Boolean);

      const payload = {
        requestId: `MFS-RESI-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        clientName, clientPhone, clientEmail,
        propertyValue, monthlyRent, productType,
        loanTypeRequired,
        specificNetLoan,
        specificLTV,
        // include criteria answers just like your previous discrete fields
        ...criteria,
        tier,
        bestSummary,
        allColumnData: columnCalculations,
        basicGrossColumnData: basicGrossCalculations,
        submissionTimestamp: new Date().toISOString(),
        revertRate: formatRevertRate(tier),
        totalTerm: `${TOTAL_TERM} years`,
        erc: formatERC(productType),
        currentMVR: CURRENT_MVR,
        standardBBR: STANDARD_BBR,
      };

      let success = false;

      try {
        const res = await fetch(zapierWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) success = true;
      } catch (e) {
        console.warn("JSON POST failed (expected in browser due to CORS):", e);
      }

      if (!success) {
        try {
          const form = new URLSearchParams();
          for (const [k, v] of Object.entries(payload)) {
            form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
          }
          const res2 = await fetch(zapierWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: form.toString(),
          });
          if (res2.ok) success = true;
        } catch (e2) {
          console.warn("Form-encoded POST failed:", e2);
        }
      }

      setSendStatus(success ? "success" : "error");
    } catch (error) {
      console.error("An unexpected error occurred in handleSendQuote:", error);
      setSendStatus("error");
    } finally {
      setSending(false);
    }
  };

  /* --------------------------- Inline value styles -------------------------- */
  const valueBoxStyle = {
    width: "100%",
    textAlign: "center",
    fontWeight: 400,
    background: "ffffff",
    borderRadius: 8,
    padding: "8px 10px",
  };

  const deferredCap = isTracker ? MAX_DEFERRED_TRACKER : MAX_DEFERRED_FIX;
  const maxLTVForTier = getMaxLTV(tier, flatAboveCommVal);

  /* ----------------------------------- UI ----------------------------------- */
  return (
    <div className="container">
      {/* --------------------- Property Details (full width) -------------------- */}
      <div className="card" style={{ gridColumn: "1 / -1", position: "relative" }}>
        <div className="note" style={{ marginBottom: 8 }}>
          Tier is calculated automatically from the inputs below. Current:{" "}
          <b>{tier}</b>
        </div>

        <div className="profile-grid">
          <SectionTitle>Property Type</SectionTitle>

          {/* Property questions (dynamic) */}
          {(window.CRITERIA_CONFIG?.propertyQuestions || []).map(q => (
            <div className={`field ${q.key === "flatAboveComm" ? "flat-above-comm-field" : ""}`} key={q.key}>
              <label htmlFor={q.key}>{q.label}</label>
              <select
                id={q.key}
                value={criteria[q.key]}
                onChange={(e) => handleCriteriaChange(q.key, e.target.value)}
              >
                {q.options.map(o => (
                  <option key={typeof o === 'string' ? o : o.label}>
                    {typeof o === 'string' ? o : o.label}
                  </option>
                ))}
              </select>

              {q.helper && (
                <div style={{
                  marginTop: 8,
                  background: '#f1f5f9',
                  color: '#475569',
                  fontSize: 12,
                  padding: '8px 10px',
                  borderRadius: 8,
                  textAlign: 'center'
                }}>
                  {q.helper}
                </div>
              )}
            </div>
          ))}

          <SectionTitle>Applicant Details</SectionTitle>

          {/* Applicant questions (dynamic) */}
          {(window.CRITERIA_CONFIG?.applicantQuestions || []).map(q => (
            <div className="field" key={q.key}>
              <label htmlFor={q.key}>{q.label}</label>
              <select
                id={q.key}
                value={criteria[q.key]}
                onChange={(e) => handleCriteriaChange(q.key, e.target.value)}
              >
                {q.options.map(o => (
                  <option key={typeof o === 'string' ? o : o.label}>
                    {typeof o === 'string' ? o : o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Adverse follow-ups */}
          {criteria.adverse === "Yes" && (
            <>
              {(window.CRITERIA_CONFIG?.adverseQuestions || []).map(q => (
                <div className="field" key={q.key}>
                  <label htmlFor={q.key}>{q.label}</label>
                  <select
                    id={q.key}
                    value={criteria[q.key]}
                    onChange={(e) => handleCriteriaChange(q.key, e.target.value)}
                  >
                    {q.options.map(o => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </div>
              ))}
            </>
          )}

          <SectionTitle>Property & Product</SectionTitle>

          <div className="profile-grid property-product" style={{ gridColumn: "1 / -1" }}>
            <div className="field">
              <label>Property Value</label>
              <input
                type="number"
                inputMode="decimal"
                placeholder="e.g. 350,000"
                value={propertyValue}
                onChange={(e) => setPropertyValue(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Monthly Rent</label>
              <input
                type="number"
                inputMode="decimal"
                placeholder="e.g. 1,600"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
              />
            </div>

            {/* Loan Type Required */}
            <div className="field">
              <label>Loan type required?</label>
              <select value={loanTypeRequired} onChange={(e) => setLoanTypeRequired(e.target.value)}>
                <option>Max Optimum Gross Loan</option>
                <option>Specific Net Loan</option>
                <option>Maximum LTV Loan</option>
              </select>
            </div>

            {/* Specific Net Loan */}
            {loanTypeRequired === "Specific Net Loan" && (
              <div className="field">
                <label>Specific Net Loan</label>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 200,000"
                  value={specificNetLoan}
                  onChange={(e) => setSpecificNetLoan(e.target.value)}
                />
              </div>
            )}

            {/* Specific LTV Slider */}
            {loanTypeRequired === "Maximum LTV Loan" && (
              <div className="field">
                <label>Specific LTV Cap</label>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
                  LTV: <b>{(specificLTV * 100).toFixed(2)}%</b>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={maxLTVForTier}
                  step={0.005}
                  value={specificLTV}
                  onChange={(e) => setSpecificLTV(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{
                  marginTop: 8,
                  background: '#f1f5f9',
                  color: '#475569',
                  fontSize: 12,
                  padding: '8px 10px',
                  borderRadius: 8,
                  textAlign: 'center'
                }}>
                  Max LTV for {tier} is {(maxLTVForTier * 100).toFixed(2)}%
                </div>
              </div>
            )}

            <div className="field">
              <label>Product Type</label>
              <select value={productType} onChange={(e) => setProductType(e.target.value)}>
                {window.PRODUCT_TYPES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------- Client Details & Lead (full) --------------------- */}
      <div className="card" style={{ gridColumn: "1 / -1" }}>
        <h4>Email this Quote</h4>
        <div className="profile-grid">
          <div className="field">
            <label>Client Name</label>
            <input
              type="text"
              placeholder="e.g. John Smith"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Contact Number</label>
            <input
              type="tel"
              placeholder="e.g. 07123 456789"
              value={clientPhone}
              onChange={(e) => setClientPhone(cleanDigits(e.target.value))}
            />
          </div>

          <div className="field">
            <label>Email Address</label>
            <input
              type="email"
              placeholder="e.g. john@example.com"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
            />
          </div>

          <div className="field" style={{ alignSelf: "end" }}>
            <button
              onClick={handleSendQuote}
              className="primaryBtn"
              disabled={sending || !canShowMatrix}
            >
              {sending ? "Sending…" : "Send Email"}
            </button>
            <div className="note"></div>
          </div>
        </div>

        {validationError && (
          <div style={{ marginTop: "16px", color: "#b91c1c", fontWeight: "500", textAlign: "center" }}>
            {validationError}
          </div>
        )}
        {sendStatus === "success" && (
          <div style={{ marginTop: "16px", padding: "16px", background: "#f0fdf4", border: "1px solid #4ade80", color: "#166534", borderRadius: "8px" }}>
            Email sent successfully!
          </div>
        )}
        {sendStatus === "error" && (
          <div style={{ marginTop: "16px", padding: "16px", background: "#fff1f2", border: "1px solid #f87171", color: "#b91c1c", borderRadius: "8px" }}>
            Failed to send email. Please try again later.
          </div>
        )}
      </div>

      {/* ===== Maximum Loan Summary ===== */}
      {canShowMatrix && bestSummary && (
        <div
          className="card"
          style={{
            gridColumn: "1 / -1",
            background: "#008891",
            color: "#fff",
            padding: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              textAlign: "center",
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            {loanTypeRequired === "Max Optimum Gross Loan"
              ? "Based on the inputs, the maximum gross loan is:"
              : `${loanTypeRequired} is:`}
          </div>

          <div style={{ padding: "12px 16px" }}>
            <div
              style={{
                background: "#ffffff",
                color: "#111827",
                borderRadius: 8,
                padding: "14px 16px",
                fontSize: 22,
                fontWeight: 800,
                textAlign: "center",
              }}
            >
              {bestSummary.grossStr} @ {bestSummary.grossLtvPct}% LTV, {productType},{" "}
              {tier}, {Number(bestSummary.colKey)}% Fee
            </div>

            <div
              style={{
                marginTop: 8,
                background: "#00285b",
                color: "#ffffff",
                borderRadius: 8,
                padding: "8px 12px",
                textAlign: "center",
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 800, textDecoration: "underline" }}>
                Max net loan
              </span>{" "}
              <span style={{ opacity: 0.95 }}>
                (amount advanced day 1) is {bestSummary.netStr} @{" "}
                {bestSummary.netLtvPct}% LTV, {productType}, {tier},{" "}
                {Number(bestSummary.colKey)}% Fee
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------- OUTPUT MATRIX ---------------- */}
      {canShowMatrix && (
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="matrix">
            {(() => {
              const colData = allColumnData;
              const anyBelowMin = colData.some((d) => d.belowMin);
              const anyAtMaxCap = colData.some((d) => d.hitMaxCap);

              return (
                <>
                  {(anyBelowMin || anyAtMaxCap) && (
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        margin: "8px 0 12px 0",
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "#fff7ed",
                        border: "1px solid #fed7aa",
                        color: "#7c2d12",
                        fontWeight: 600,
                        textAlign: "center",
                      }}
                    >
                      {anyBelowMin &&
                        "One or more gross loans are below the £150,000 minimum threshold. "}
                      {anyAtMaxCap &&
                        "One or more gross loans are capped at the £3,000,000 maximum."}
                    </div>
                  )}

                  {/* Labels */}
                  <div className="matrixLabels" style={{ display: "flex", flexDirection: "column" }}>
                    <div className="labelsHead"></div>
                    <div className="mRow"><b></b></div>
                    <div className="mRow"><b>Product Name</b></div>
                    <div className="mRow"><b>Full Rate (Editable)</b></div>
                    <div className="mRow"><b>Pay Rate</b></div>
                    <div className="mRow"><b>Net Loan <span style={{ fontSize: "11px", fontWeight: 400 }}>(advanced day 1)</span></b></div>
                    <div className="mRow"><b>Max Gross Loan<span style={{ fontSize: "11px", fontWeight: 400 }}>(paid at redemption)</span></b></div>
                    <div className="mRow"><b>Rolled Months</b></div>
                    <div className="mRow"><b>Deferred Adjustment</b></div>
                    <div className="mRow"><b>Product Fee</b></div>
                    <div className="mRow"><b>Rolled Months Interest</b></div>
                    <div className="mRow"><b>Deferred Interest</b></div>
                    <div className="mRow"><b>Direct Debit</b></div>
                    <div className="mRow"><b>Revert Rate</b></div>
                    <div className="mRow"><b>Total Term | ERC</b></div>
                    <div className="mRow"><b>Max Product LTV</b></div>
                  </div>

                  {/* Columns */}
                  {colData.map((data, idx) => {
                    const colKey = data.colKey;
                    const headClass =
                      idx === 0 ? "headGreen" : idx === 1 ? "headOrange" : idx === 2 ? "headTeal" : "headBlue";

                    const manual = manualSettings[colKey];
                    const deferredCap = isTracker ? MAX_DEFERRED_TRACKER : MAX_DEFERRED_FIX;
                    const deferredStep = 0.0001;

                    const rateDisplayValue = tempRateInput[colKey] !== undefined
                      ? tempRateInput[colKey]
                      : `${(data.actualRateUsed * 100).toFixed(2)}%`;

                    const isOverridden = data.isRateOverridden;

                    return (
                      <div key={colKey} className="matrixCol" style={{ display: "flex", flexDirection: "column" }}>
                        <div className={`matrixHead ${headClass}`}>BTL, {Number(colKey)}% Product Fee</div>

                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{data.productName}</div></div>

                        {/* Full Rate Input */}
                        <div className="mRow">
                          <div
                            className="mValue"
                            style={{
                              ...valueBoxStyle,
                              background: '#fefce8',
                              padding: '4px 10px',
                              border: isOverridden ? '1px solid #fde047' : '1px solid #e2e8f0',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <input
                              type="text"
                              value={rateDisplayValue}
                              onChange={(e) => handleRateInputChange(colKey, e.target.value)}
                              onBlur={(e) => handleRateInputBlur(colKey, e.target.value, data.actualRateUsed)}
                              placeholder={data.fullRateText}
                              style={{
                                width: '100%',
                                border: 'none',
                                textAlign: 'center',
                                fontWeight: 700,
                                background: 'transparent',
                                color: isOverridden ? '#ca8a04' : '#1e293b',
                              }}
                            />

                            {isOverridden && (
                              <button
                                onClick={() => handleResetRateOverride(colKey)}
                                style={{
                                  fontSize: 10,
                                  color: "#ca8a04",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  marginTop: 4,
                                }}
                              >
                                (Reset Rate)
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mRow">
                          <div className="mValue" style={valueBoxStyle}>
                            {data.payRateText}
                            <span style={{ fontWeight: 500, fontSize: 10, marginLeft: 6 }}>
                              (using {(data.deferredCapPct * 100).toFixed(2)}% deferred)
                            </span>
                          </div>
                        </div>

                        <div className="mRow">
                          <div className="mValue" style={valueBoxStyle}>
                            <span style={{ fontWeight: 700 }}>{fmtMoney0(data.net)}</span>
                            {data.netLtv != null && (
                              <span style={{ fontWeight: 400 }}>
                                {" "} @ {Math.round(data.netLtv * 100)}% LTV
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Gross & sliders */}
                        <div className="mRow">
                          <div className="mValue" style={valueBoxStyle}>
                            <span style={{ fontWeight: 700 }}>{fmtMoney0(data.gross)}</span>
                            {data.ltv != null && (
                              <span style={{ fontWeight: 400 }}>
                                {" "} @ {Math.round(data.ltv * 100)}% LTV
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mRow" style={{ alignItems: 'center' }}>
                          <div
                            style={{
                              width: '100%',
                              background: manual?.rolledMonths != null ? "#fefce8" : "#fff",
                              borderRadius: 8,
                              padding: "1px 1px",
                              marginTop: 4,
                              marginBottom: 4,
                            }}
                          >
                            <SliderInput
                              label=""
                              min={0}
                              max={Math.min(MAX_ROLLED_MONTHS, data.termMonths)}
                              step={1}
                              value={manual?.rolledMonths ?? data.rolledMonths}
                              onChange={(val) => handleRolledChange(colKey, val)}
                              formatValue={(v) => `${v} months`}
                              style={{ margin: "4px 0" }}
                            />
                          </div>
                        </div>

                        <div className="mRow" style={{ alignItems: 'center' }}>
                          <div
                            style={{
                              width: '100%',
                              background: manual?.deferredPct != null ? "#fefce8" : "#fff",
                              borderRadius: 8,
                              padding: "1px 1px",
                              marginTop: 4,
                              marginBottom: 4,
                            }}
                          >
                            <SliderInput
                              label=""
                              min={0}
                              max={deferredCap}
                              step={deferredStep}
                              value={manual?.deferredPct ?? data.deferredCapPct}
                              onChange={(val) => handleDeferredChange(colKey, val)}
                              formatValue={(v) => fmtPct(v, 2)}
                              style={{ margin: "4px 0" }}
                            />

                            {(manual?.rolledMonths != null || manual?.deferredPct != null) && (
                              <button
                                onClick={() => handleResetManual(colKey)}
                                style={{
                                  fontSize: 10,
                                  color: "#ca8a04",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  marginTop: 4,
                                  alignSelf: "end",
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'right'
                                }}
                              >
                                (Reset to Optimum)
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{fmtMoney0(data.feeAmt)} ({Number(colKey).toFixed(2)}%)</div></div>
                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{fmtMoney0(data.rolled)} ({data.rolledMonths} months)</div></div>
                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{fmtMoney0(data.deferred)} ({(data.deferredCapPct * 100).toFixed(2)}%)</div></div>
                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{fmtMoney0(data.directDebit)} from month {data.ddStartMonth}</div></div>
                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{formatRevertRate(tier)}</div></div>
                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{TOTAL_TERM} years | {formatERC(productType)}</div></div>
                        <div className="mRow"><div className="mValue" style={valueBoxStyle}>{(data.maxLtvRule * 100).toFixed(0)}%</div></div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ------------- EXTRA: Basic Gross (aligned under columns) + MVR/BBR ---- */}
      {canShowMatrix && (
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div
            style={{
              textAlign: "center",
              color: "#7c2d12",
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: 10,
              padding: "10px 12px",
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Results currently use optimum rolled and deferred interest for maximum net loan, *unless manually overridden by the sliders or the rate field.*
          </div>

          <div className="matrix" style={{ rowGap: 0 }}>
            <div
              className="matrixLabels"
              style={{
                display: "grid",
                gridTemplateRows: `48px`,
                border: "1px solid transparent",
                background: "transparent",
              }}
            >
              <div className="mRow" style={{ justifyContent: "center", color: "#475569" }}>
                <b>Basic Gross (no roll/deferred)</b>
              </div>
            </div>

            {SHOW_FEE_COLS.map((k, idx) => {
              const d = computeBasicGrossForCol(k);
              if (!d) return null;

              return (
                <div
                  key={`basic-${k}`}
                  className="matrixCol"
                  style={{
                    display: "grid",
                    gridTemplateRows: `48px`,
                    borderTopLeftRadius: 0,
                    borderTopRightRadius: 0,
                  }}
                >
                  <div className="mRow" style={{ padding: 6 }}>
                    <div
                      className="mValue"
                      style={{
                        width: "100%",
                        textAlign: "center",
                        fontWeight: 800,
                        background: "#f1f5f9",
                        borderRadius: 8,
                        padding: "10px 12px",
                      }}
                    >
                      {fmtMoney0(d.grossBasic)}{" "}
                      <span style={{ fontWeight: 700 }}>
                        @ {d.ltvPctBasic != null ? `${d.ltvPctBasic}% LTV` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ gridColumn: "1 / -1", textAlign: "center", marginTop: 12, fontSize: 12, color: "#334155" }}>
            <span style={{ marginRight: 16 }}>
              <b>MVR (Market Financial Solutions Variable Rate)</b> is currently{" "}
              {(CURRENT_MVR * 100).toFixed(2)}%
            </span>
            <span>
              <b>BBR</b> is currently {(STANDARD_BBR * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
