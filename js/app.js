const WX_MAP = {
  "-RA": "Light rain",
  "RA": "Rain",
  "+RA": "Heavy rain",
  "TS": "Thunderstorm",
  "TSRA": "Thunderstorm with rain",
  "BR": "Mist",
  "FG": "Fog",
  "HZ": "Haze",
  "-SHRA": "Light rain showers",
  "SHRA": "Rain showers",
  "+SHRA": "Heavy rain showers"
};

export function toUpperICAO(s){
  return (s || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0,4);
}

export function safeText(s){
  return (s ?? "").toString();
}

export function levelEmoji(level){
  if (level === "bad") return "⛔";
  if (level === "warn") return "⚠️";
  return "ℹ️";
}

export function parseMetar(raw){
  const text = (raw || "").trim();
  const parts = text.split(/\s+/);

  const station = parts[0] || "----";
  const timeToken = parts.find(p => /^\d{6}Z$/.test(p)) || null;
  const windToken = parts.find(p => /^(VRB|\d{3})\d{2,3}(G\d{2,3})?KT$/.test(p)) || null;
  const qnhToken  = parts.find(p => /^(Q\d{4}|A\d{4})$/.test(p)) || null;
  const tempToken = parts.find(p => /^M?\d{2}\/M?\d{2}$/.test(p)) || null;

  const visToken = parts.find(p => /^\d{4}$/.test(p)) || parts.find(p => /SM$/.test(p)) || null;
  const clouds = parts.filter(p => /^(FEW|SCT|BKN|OVC)\d{3}/.test(p));
  const wxTokens = parts.filter(p => WX_MAP[p] || /^[\+\-]?(TS|RA|FG|BR|HZ|SHRA)$/.test(p));

  // Ceiling: lowest BKN/OVC layer
  const ceilingFt = (() => {
    const layers = clouds
      .map(c => ({ code: c.slice(0,3), ft: parseInt(c.slice(3,6),10) * 100 }))
      .filter(x => !Number.isNaN(x.ft));
    const ceil = layers.filter(x => x.code === "BKN" || x.code === "OVC");
    if (!ceil.length) return null;
    return ceil.sort((a,b)=>a.ft-b.ft)[0].ft;
  })();

  const visM = (() => {
    if (!visToken) return null;
    if (/^\d{4}$/.test(visToken)) return parseInt(visToken,10);
    const m = visToken.match(/^(\d+)(?:\/(\d+))?SM$/);
    if (!m) return null;
    const whole = parseInt(m[1],10);
    const frac = m[2] ? (1 / parseInt(m[2],10)) : 0;
    const sm = whole + frac;
    return Math.round(sm * 1609.34);
  })();

  const wind = (() => {
    if (!windToken) return { dir: null, spdKt: null, gstKt: null, raw: null };
    const m = windToken.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/);
    if (!m) return { dir: null, spdKt: null, gstKt: null, raw: windToken };
    return { dir: m[1], spdKt: parseInt(m[2],10), gstKt: m[3] ? parseInt(m[3],10) : null, raw: windToken };
  })();

  const qnh = (() => {
    if (!qnhToken) return { hpa: null, inHg: null, raw: null };
    if (qnhToken.startsWith("Q")){
      const hpa = parseInt(qnhToken.slice(1),10);
      const inHg = +(hpa * 0.0295299830714).toFixed(2);
      return { hpa, inHg, raw: qnhToken };
    }
    if (qnhToken.startsWith("A")){
      const inHg = parseInt(qnhToken.slice(1),10) / 100;
      const hpa = Math.round(inHg / 0.0295299830714);
      return { hpa, inHg: +inHg.toFixed(2), raw: qnhToken };
    }
    return { hpa: null, inHg: null, raw: qnhToken };
  })();

  const temp = (() => {
    if (!tempToken) return { c: null, dewC: null, raw: null };
    const [t, d] = tempToken.split("/");
    const tc = t.startsWith("M") ? -parseInt(t.slice(1),10) : parseInt(t,10);
    const dc = d.startsWith("M") ? -parseInt(d.slice(1),10) : parseInt(d,10);
    return { c: tc, dewC: dc, raw: tempToken };
  })();

  const wx = wxTokens.map(t => WX_MAP[t] || t);

  return { station, timeToken, wind, visM, clouds, ceilingFt, qnh, temp, wx, raw: text };
}

export function flightCategory({ ceilingFt, visM }){
  const ceil = ceilingFt ?? Infinity;
  const vis = visM ?? Infinity;

  if (ceil < 500 || vis < 1600) return "LIFR";
  if (ceil < 1000 || vis < 4800) return "IFR";
  if (ceil <= 3000 || vis <= 8000) return "MVFR";
  return "VFR";
}

export function alertsFromMetar(m){
  const out = [];
  if (!m) return out;

  if (m.wind?.gstKt && m.wind.gstKt >= 25) out.push({ level: "warn", text: `Gusts ${m.wind.gstKt} kt` });
  if (m.wind?.spdKt && m.wind.spdKt >= 20) out.push({ level: "info", text: `Wind ${m.wind.spdKt} kt` });

  if (typeof m.visM === "number"){
    if (m.visM < 1600) out.push({ level: "bad", text: `Very low visibility (${m.visM} m)` });
    else if (m.visM < 4800) out.push({ level: "warn", text: `Low visibility (${m.visM} m)` });
  }

  if (typeof m.ceilingFt === "number"){
    if (m.ceilingFt < 500) out.push({ level: "bad", text: `Ceiling very low (${m.ceilingFt} ft)` });
    else if (m.ceilingFt < 1000) out.push({ level: "warn", text: `Ceiling low (${m.ceilingFt} ft)` });
  }

  if (m.raw.includes("TS")) out.push({ level: "bad", text: "Thunderstorm risk (TS)" });
  if (m.raw.includes("FG")) out.push({ level: "bad", text: "Fog (FG)" });
  if (m.raw.includes("BR")) out.push({ level: "warn", text: "Mist (BR)" });
  if (m.raw.includes("HZ")) out.push({ level: "warn", text: "Haze (HZ)" });
  if (m.raw.includes("RA")) out.push({ level: "info", text: "Rain present" });

  return out;
}

export function niceTimeFromToken(token){
  if (!token || !/^\d{6}Z$/.test(token)) return "—";
  const day = token.slice(0,2);
  const hh = token.slice(2,4);
  const mm = token.slice(4,6);
  return `Day ${day} ${hh}:${mm}Z`;
}

export function catBadgeClass(cat){
  switch(cat){
    case "VFR": return "badge--vfr";
    case "MVFR": return "badge--mvfr";
    case "IFR": return "badge--ifr";
    case "LIFR": return "badge--lifr";
    default: return "badge--neutral";
  }
}

export function formatUnits(m, mode){
  const wind = m.wind?.raw ? m.wind.raw.replace("KT", mode === "us" ? " kt" : "KT") : "—";

  const vis = (() => {
    if (typeof m.visM !== "number") return "—";
    if (mode === "us"){
      const sm = m.visM / 1609.34;
      return `${sm.toFixed(sm >= 10 ? 0 : 1)} sm`;
    }
    return `${m.visM} m`;
  })();

  const ceil = (typeof m.ceilingFt === "number") ? `${m.ceilingFt} ft` : "—";

  const qnh = (() => {
    if (mode === "us") return m.qnh?.inHg ? `${m.qnh.inHg} inHg` : "—";
    return m.qnh?.hpa ? `${m.qnh.hpa} hPa` : "—";
  })();

  return { wind, vis, ceil, qnh };
}

export function metarToDL(m, unitsMode){
  const u = formatUnits(m, unitsMode);
  const wx = m.wx?.length ? m.wx.join(", ") : "None";
  const clouds = m.clouds?.length ? m.clouds.join(" ") : "None";

  return [
    ["Station", m.station],
    ["Observation Time", niceTimeFromToken(m.timeToken)],
    ["Wind", u.wind],
    ["Visibility", u.vis],
    ["Ceiling", u.ceil],
    ["Cloud Layers", clouds],
    ["Weather", wx],
    ["Temp / Dew", `${m.temp?.c ?? "—"}°C / ${m.temp?.dewC ?? "—"}°C`],
    ["QNH", u.qnh],
  ];
}

export function tafToDL(rawTaf){
  const t = (rawTaf || "").trim();
  if (!t) return [];
  return [
    ["Contains FM", t.includes(" FM") ? "Yes" : "No"],
    ["Contains TEMPO", t.includes(" TEMPO ") ? "Yes" : "No"],
    ["Contains BECMG", t.includes(" BECMG ") ? "Yes" : "No"],
    ["Length", `${t.length} chars`],
  ];
}

export function splitTafSegments(rawTaf){
  const t = (rawTaf || "").trim();
  if (!t) return [];

  const starters = ["FM", "TEMPO", "BECMG", "PROB30", "PROB40"];
  const tokens = t.split(/\s+/);

  let i = 0;
  while (i < tokens.length && !starters.some(s => tokens[i].startsWith(s))) i++;

  const header = tokens.slice(0, i).join(" ");
  const rest = tokens.slice(i);

  const segments = [];
  let current = { tag: "BASE", time: "", body: "" };

  function pushCurrent(){
    if (current.body.trim()){
      segments.push({ ...current, header });
    }
  }

  for (let j = 0; j < rest.length; j++){
    const tok = rest[j];
    const isStart = starters.some(s => tok.startsWith(s));
    if (isStart){
      pushCurrent();
      current = {
        tag: tok.startsWith("FM") ? "FM" : tok.startsWith("PROB") ? tok.slice(0,6) : tok,
        time: tok,
        body: ""
      };
    } else {
      current.body += (current.body ? " " : "") + tok;
    }
  }
  pushCurrent();

  return [{ tag: "HEADER", time: "", body: header, header }, ...segments];
}
