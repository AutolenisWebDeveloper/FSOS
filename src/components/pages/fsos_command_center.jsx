import { useState, useEffect, useCallback, useRef } from "react";

// Small GHL stage chip shown across pages (Opportunities, Conversions, OPRA,
// Agency Owners). `stage`/`pos` come from the API's per-row `ghl` object.
function GhlBadge({ stage, pos, pipeline, inGhl }) {
  if (stage) return (
    <span title={pipeline ? `GHL · ${pipeline}` : "GoHighLevel pipeline stage"}
      style={{fontSize:9,background:"#f0e9ff",color:"#6b46c1",border:"1px solid #d6bcfa",borderRadius:3,padding:"2px 6px",fontFamily:"DM Mono,monospace",whiteSpace:"nowrap"}}>
      ◆ {pos ? `${pos}. ` : ""}{stage}
    </span>
  );
  if (inGhl) return (
    <span title="Synced to GoHighLevel (no opportunity stage yet)"
      style={{fontSize:9,background:"transparent",color:"var(--muted)",border:"1px dashed var(--border)",borderRadius:3,padding:"2px 6px",fontFamily:"DM Mono,monospace",whiteSpace:"nowrap"}}>
      ◇ In GHL
    </span>
  );
  return null;
}

// POST to /api/ghl/sync (same-origin, replays the command-center auth cookie).
// Returns { ok, data }. Callers toast the outcome. Gracefully reports the
// "GHL not configured" (503) case so the button is safe before GHL_API_KEY set.
async function syncToGhl(body) {
  try {
    const res = await fetch("/api/ghl/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e?.message || "Network error" } };
  }
}

// ─────────────────────────────────────────────────────────
// LIVE DATA HOOK — single fetch, shared across all pages
// Fetches /api/dashboard once on mount, exposes all live data
// Falls back to empty arrays so every page renders while loading
// ─────────────────────────────────────────────────────────
function useAppData() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/dashboard");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Surface the server's message (e.g. "Supabase is not configured …")
        // instead of an opaque status code.
        throw new Error(d.error || ("HTTP " + r.status));
      }
      setData(d);
      setLastFetch(new Date());
    } catch (e) {
      console.error("Dashboard fetch error:", e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return {
    loading,
    error,
    lastFetch,
    refresh: fetch_,
    // Safely destructure every field the UI needs
    briefing:           data?.briefing ?? null,
    urgentConversions:  data?.urgent_conversions ?? [],
    opraDue:            data?.opra_due ?? [],
    topOpportunities:   data?.top_opportunities ?? [],
    recentReferrals:    data?.recent_referrals ?? [],
    pendingForms:       data?.pending_forms ?? [],
    gdc:                data?.gdc ?? { issued_ytd:0, fsa_ytd:0, pipeline:0, pipeline_fsa:0, tier:1, tier_rate:0.40, tier_label:"Tier 1" },
    counts:             data?.counts ?? { urgent_conversions:0, opra_due:0, pending_forms:0, new_referrals:0 },
  };
}


// ─────────────────────────────────────────────────────────
// MARKIST FSA COMMAND CENTER — v2
// New in this version:
// 1. Tiered GDC payout (40%/60%/80%) — corrected from flat 80%
// 2. FFS Contacts quick-panel (Matt Anderson, Ando Agamalian, etc.)
// 3. GDC & Commission page with tier-aware calculator
// 4. Customer Needs Map (age cohort → products) from FFS guide
// 5. Business Owner pipeline and scoring track
// 6. Financial Review prep — pre-meeting form status per appointment
// 7. Sales Activity Calculator (10-3-1 model)
// 8. Workshops page fully integrated
// ─────────────────────────────────────────────────────────

const G = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

:root {
  --navy:#0f1e36;--white:#fff;--bg:#f4f6f9;--bg2:#edf0f4;
  --card:#fff;--border:#e4e8ef;--text:#1a2332;--muted:#6b7a8d;--dim:#a8b4c0;
  --red:#e53e3e;--red-bg:#fff5f5;--red-border:#fed7d7;
  --orange:#dd6b20;--orange-bg:#fffaf0;--orange-border:#fbd38d;
  --green:#276749;--green2:#38a169;--green-bg:#f0fff4;--green-border:#9ae6b4;
  --blue:#2b6cb0;--blue-bg:#ebf8ff;--blue-border:#bee3f8;
  --purple:#553c9a;--purple-bg:#faf5ff;--purple-border:#d6bcfa;
  --gold:#b7791f;--gold-bg:#fffff0;--gold-border:#f6e05e;
  --teal:#0a5060;--teal-bg:#f0f8fa;--teal-border:#a0d0da;
  --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.05);
  --shadow2:0 4px 12px rgba(0,0,0,.1);
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;line-height:1.5;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:2px;}
.shell{display:flex;min-height:100vh;}

/* SIDEBAR */
.sidebar{width:228px;background:var(--navy);display:flex;flex-direction:column;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;}
.sidebar-logo{padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.08);}
.sb-logo-top{display:flex;align-items:center;gap:8px;margin-bottom:4px;}
.sb-badge{width:32px;height:32px;background:linear-gradient(135deg,#4299e1,#2b6cb0);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;}
.sb-name{font-size:14px;font-weight:600;color:#fff;}
.sb-sub{font-size:9px;color:rgba(255,255,255,.4);font-family:'DM Mono',monospace;letter-spacing:.06em;text-transform:uppercase;margin-left:40px;}
.sb-sec{padding:13px 12px 5px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.28);}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 14px;border:none;background:transparent;color:rgba(255,255,255,.52);cursor:pointer;text-align:left;font-family:'DM Sans',sans-serif;font-size:12px;width:100%;transition:all .15s;position:relative;}
.nav-item:hover{color:rgba(255,255,255,.9);background:rgba(255,255,255,.05);}
.nav-item.active{color:#fff;background:rgba(255,255,255,.1);font-weight:500;}
.nav-item.active::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#4299e1;border-radius:0 2px 2px 0;}
.ni-icon{width:15px;text-align:center;font-size:13px;}
.ni-badge{margin-left:auto;background:#4299e1;color:#fff;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;min-width:16px;text-align:center;}
.ni-badge.red{background:#e53e3e;}.ni-badge.green{background:#38a169;}.ni-badge.orange{background:#dd6b20;}
.agents-box{padding:10px;margin:6px 10px;background:rgba(255,255,255,.05);border-radius:7px;border:1px solid rgba(255,255,255,.08);}
.ab-title{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.32);margin-bottom:8px;}
.agent-row{display:flex;align-items:center;gap:7px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06);}
.agent-row:last-child{border-bottom:none;}
.a-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
.a-dot.online{background:#48bb78;animation:pulse 2s ease-in-out infinite;}
.a-dot.running{background:#4299e1;animation:pulse 1.5s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.a-name{font-size:10px;color:rgba(255,255,255,.68);flex:1;}
.a-ct{font-family:'DM Mono',monospace;font-size:9px;color:rgba(255,255,255,.3);}

/* TIER BADGE in sidebar */
.tier-box{margin:8px 10px;padding:10px 12px;background:rgba(255,255,255,.06);border-radius:7px;border:1px solid rgba(255,255,255,.1);}
.tier-label{font-family:'DM Mono',monospace;font-size:9px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px;}
.tier-val{font-size:15px;font-weight:600;color:#f0b429;}
.tier-sub{font-size:9px;color:rgba(255,255,255,.35);margin-top:2px;}

/* FFS CONTACTS in sidebar */
.contacts-box{margin:6px 10px;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:7px;border:1px solid rgba(255,255,255,.08);}
.contacts-title{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:8px;}
.contact-row{padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);}
.contact-row:last-child{border-bottom:none;}
.contact-name{font-size:10px;font-weight:500;color:rgba(255,255,255,.75);}
.contact-role{font-size:9px;color:rgba(255,255,255,.35);margin-bottom:2px;}
.contact-tel{font-family:'DM Mono',monospace;font-size:9px;color:#4299e1;cursor:pointer;text-decoration:none;display:block;}

.sb-bottom{margin-top:auto;padding:10px;border-top:1px solid rgba(255,255,255,.08);}
.help-btn{display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:5px;background:rgba(255,255,255,.06);border:none;color:rgba(255,255,255,.55);font-family:'DM Sans',sans-serif;font-size:10px;cursor:pointer;width:100%;transition:all .15s;}
.help-btn:hover{background:rgba(255,255,255,.1);color:#fff;}
.help-sub{font-size:8px;color:#4299e1;margin-top:1px;}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;min-width:0;}
.topbar{height:54px;background:var(--card);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 22px;gap:14px;position:sticky;top:0;z-index:50;}
.tb-title{font-size:17px;font-weight:600;color:var(--text);}
.tb-sub{font-size:11px;color:var(--muted);margin-left:3px;}
.tb-date{margin-left:auto;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);}
.import-btn{display:flex;align-items:center;gap:5px;padding:7px 14px;border-radius:5px;border:none;background:#2b6cb0;color:#fff;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;cursor:pointer;transition:background .15s;white-space:nowrap;}
.import-btn:hover{background:#2c5282;}
.page{padding:18px 22px 40px;}
.page-title{font-size:19px;font-weight:600;color:var(--text);margin-bottom:14px;}

/* KPI STRIP */
.kpi-strip{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px;}
.kpi-card{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:14px;box-shadow:var(--shadow);display:flex;align-items:flex-start;justify-content:space-between;}
.kpi-label{font-size:10px;color:var(--muted);font-weight:500;margin-bottom:5px;}
.kpi-val{font-size:28px;font-weight:700;line-height:1;color:var(--text);}
.kpi-delta{font-size:10px;margin-top:4px;}
.kpi-delta.up{color:var(--green2);}.kpi-delta.down{color:var(--red);}
.kpi-icon{width:40px;height:40px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}

/* GRID */
.main-grid{display:grid;grid-template-columns:1.3fr 1fr 0.9fr;gap:14px;margin-bottom:14px;}
.col{display:flex;flex-direction:column;gap:14px;}

/* CARD */
.card{background:var(--card);border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow);overflow:hidden;}
.card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid var(--border);}
.card-title{font-size:12px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px;}
.card-link{font-size:10px;color:#2b6cb0;background:none;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;}
.card-body{padding:14px;}

/* PRIORITY */
.priority-item{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:7px;border:1px solid var(--border);background:var(--bg);margin-bottom:7px;transition:all .15s;cursor:pointer;}
.priority-item:hover{border-color:#bee3f8;box-shadow:var(--shadow2);}
.priority-item:last-child{margin-bottom:0;}
.p-num{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;margin-top:1px;}
.p-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#4299e1,#2b6cb0);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;}
.p-info{flex:1;min-width:0;}
.p-name{font-size:12px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.pbadge{font-size:8px;font-family:'DM Mono',monospace;font-weight:500;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;}
.pbadge.hi{background:var(--red-bg);color:var(--red);border:1px solid var(--red-border);}
.pbadge.md{background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-border);}
.pbadge.lo{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border);}
.pbadge.biz{background:var(--purple-bg);color:var(--purple);border:1px solid var(--purple-border);}
.p-reason{font-size:10px;color:var(--muted);margin-top:2px;}
.p-meta{display:flex;gap:10px;margin-top:4px;font-size:9px;color:var(--dim);font-family:'DM Mono',monospace;}
.p-right{display:flex;flex-direction:column;align-items:flex-end;gap:5px;}
.score-v{font-size:20px;font-weight:700;color:#2b6cb0;line-height:1;}
.score-l{font-size:8px;color:var(--muted);font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.06em;text-align:center;}
.view-btn{padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:10px;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all .15s;}
.view-btn:hover{border-color:#bee3f8;background:var(--blue-bg);color:var(--blue);}
.view-all{text-align:center;padding-top:10px;}
.view-all-btn{font-size:11px;color:#2b6cb0;background:none;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;}

/* APPOINTMENTS */
.appt-item{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);}
.appt-item:last-child{border-bottom:none;}
.appt-time{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);width:50px;flex-shrink:0;padding-top:2px;}
.cal-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:3px;}
.appt-info{flex:1;}
.appt-name{font-size:11px;font-weight:500;color:var(--text);}
.appt-sub{font-size:9px;color:var(--muted);margin-top:1px;}
/* form status dot */
.form-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:4px;}
.form-dot.done{background:var(--green2);}
.form-dot.pending{background:var(--orange);}
.sp{font-family:'DM Mono',monospace;font-size:8px;padding:2px 6px;border-radius:3px;}
.sp-confirmed{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border);}
.sp-pending{background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-border);}
.sp-submitted{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border);}
.sp-flagged{background:var(--red-bg);color:var(--red);border:1px solid var(--red-border);}

/* AI STATS */
.ai-stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;}
.ai-stat{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:10px;text-align:center;}
.ai-stat-icon{font-size:20px;margin-bottom:4px;}
.ai-stat-val{font-size:22px;font-weight:700;color:var(--text);line-height:1;}
.ai-stat-lbl{font-size:9px;color:var(--muted);margin-top:2px;}

/* PIPELINE */
.pipeline-item{padding:7px 0;border-bottom:1px solid var(--border);}
.pipeline-item:last-child{border-bottom:none;}
.pipeline-rt{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;}
.pipeline-name{font-size:11px;color:var(--text);font-weight:500;}
.pipeline-count{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);font-weight:500;}
.pbar{height:5px;background:var(--bg2);border-radius:3px;overflow:hidden;}
.pbar-fill{height:100%;border-radius:3px;transition:width .8s ease;}

/* REVENUE */
.rev-total{font-size:28px;font-weight:700;color:var(--green);margin-bottom:3px;}
.rev-lbl{font-size:10px;color:var(--muted);margin-bottom:12px;}
.rev-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px;}
.rev-row:last-child{border-bottom:none;}
.rev-cat{color:var(--muted);}
.rev-val{font-family:'DM Mono',monospace;font-weight:500;color:var(--text);}

/* DONUT */
.donut-wrap{display:flex;align-items:center;gap:14px;}
.legend-item{display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:6px;}
.ldot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.llabel{color:var(--muted);flex:1;}
.lval{font-family:'DM Mono',monospace;font-size:10px;color:var(--text);font-weight:500;}

/* OPPORTUNITIES */
.opp-filters{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;}
.opp-filter{padding:5px 14px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;cursor:pointer;transition:all .15s;}
.opp-filter.active{background:#2b6cb0;border-color:#2b6cb0;color:#fff;}
.opp-filter:hover:not(.active){border-color:#bee3f8;color:#2b6cb0;}
.opp-card{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:14px;margin-bottom:8px;box-shadow:var(--shadow);display:grid;grid-template-columns:1fr auto;gap:10px;transition:box-shadow .15s;cursor:pointer;}
.opp-card:hover{box-shadow:var(--shadow2);border-color:#bee3f8;}
.opp-hdr{display:flex;align-items:center;gap:9px;margin-bottom:7px;}
.opp-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#4299e1,#2b6cb0);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;}
.opp-avatar.biz{background:linear-gradient(135deg,#7b2d8b,#553c9a);}
.opp-name{font-size:13px;font-weight:600;}
.opp-meta{font-size:10px;color:var(--muted);}
.opp-dets{display:flex;gap:14px;flex-wrap:wrap;}
.opp-det{font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;}
.ai-tags{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap;}
.ai-tag{font-size:9px;padding:2px 6px;border-radius:3px;background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border);font-family:'DM Mono',monospace;}
.ai-tag.green{background:var(--green-bg);color:var(--green);border-color:var(--green-border);}
.ai-tag.purple{background:var(--purple-bg);color:var(--purple);border-color:var(--purple-border);}
.opp-r{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
.opp-score{font-size:26px;font-weight:700;color:#2b6cb0;line-height:1;}
.opp-slbl{font-size:8px;color:var(--muted);font-family:'DM Mono',monospace;text-transform:uppercase;text-align:center;}
.open-btn{padding:6px 16px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;font-family:'DM Sans',sans-serif;font-weight:500;cursor:pointer;transition:all .15s;}
.open-btn:hover{background:#2b6cb0;border-color:#2b6cb0;color:#fff;}

/* CONVERSIONS */
.conv-section{margin-bottom:18px;}
.conv-head{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;margin-bottom:9px;padding-bottom:7px;border-bottom:2px solid;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.07em;}
.conv-card{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:14px;margin-bottom:7px;box-shadow:var(--shadow);display:grid;grid-template-columns:1fr auto;gap:10px;}
.conv-name{font-size:13px;font-weight:600;margin-bottom:3px;}
.conv-dets{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:7px;}
.conv-det{font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;}
.deadline{font-size:12px;font-weight:700;padding:5px 10px;border-radius:5px;text-align:center;}
.dl-urgent{background:var(--red-bg);color:var(--red);border:1px solid var(--red-border);}
.dl-soon{background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-border);}
.dl-ok{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border);}

/* AI AGENTS */
.agents-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
.agent-card{background:var(--card);border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow);overflow:hidden;}
.agent-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid var(--border);background:var(--bg);}
.agent-card-name{font-size:13px;font-weight:600;}
.asb{font-family:'DM Mono',monospace;font-size:9px;padding:2px 9px;border-radius:18px;display:flex;align-items:center;gap:4px;}
.asb.online{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border);}
.asb.running{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border);}
.asb-dot{width:4px;height:4px;border-radius:50%;background:currentColor;animation:pulse 2s ease-in-out infinite;}
.agent-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);}
.agent-stat{background:var(--card);padding:12px;text-align:center;}
.agent-stat-val{font-size:22px;font-weight:700;color:var(--text);line-height:1;}
.agent-stat-lbl{font-size:9px;color:var(--muted);margin-top:2px;}
.agent-foot{padding:10px 14px;display:flex;gap:6px;}
.a-btn{flex:1;padding:6px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:10px;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all .15s;}
.a-btn:hover{border-color:#bee3f8;color:#2b6cb0;background:var(--blue-bg);}
.a-btn.pri{background:#2b6cb0;border-color:#2b6cb0;color:#fff;}
.a-btn.pri:hover{background:#2c5282;}

/* AGENCY */
.agency-card{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:18px;margin-bottom:10px;box-shadow:var(--shadow);}
.agency-hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);}
.agency-name{font-size:15px;font-weight:600;margin-bottom:1px;}
.agency-owner{font-size:11px;color:var(--muted);}
.agency-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px;}
.agency-kpi{text-align:center;}
.akval{font-size:22px;font-weight:700;color:var(--text);line-height:1;}
.aklbl{font-size:9px;color:var(--muted);margin-top:2px;}
.agency-opp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;}
.agency-opp-item{background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;}
.aolbl{font-size:10px;color:var(--muted);}
.aoval{font-size:16px;font-weight:700;}

/* CALENDAR */
.cal-card{background:var(--card);border:1px solid var(--border);border-radius:9px;overflow:hidden;box-shadow:var(--shadow);max-width:540px;}
.cal-hdr{background:var(--navy);color:#fff;padding:14px 18px;font-size:14px;font-weight:600;letter-spacing:.02em;}
.cal-item{display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid var(--border);transition:background .1s;cursor:pointer;}
.cal-item:last-child{border-bottom:none;}
.cal-item:hover{background:var(--bg);}
.cal-time{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;color:var(--muted);width:56px;flex-shrink:0;}
.cal-dot2{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.cal-info{flex:1;}
.cal-name{font-size:12px;font-weight:500;}
.cal-type{font-size:10px;color:var(--muted);margin-top:1px;}
/* form badge in calendar */
.form-badge{font-size:8px;font-family:'DM Mono',monospace;padding:2px 5px;border-radius:3px;margin-left:4px;}
.fb-done{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border);}
.fb-pending{background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-border);}

/* GDC PAGE */
.tier-selector{display:flex;gap:0;margin-bottom:16px;border:1px solid var(--border);border-radius:7px;overflow:hidden;}
.tier-btn{flex:1;padding:10px 14px;border:none;background:var(--bg);color:var(--muted);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;text-align:center;border-right:1px solid var(--border);}
.tier-btn:last-child{border-right:none;}
.tier-btn.active.t1{background:#fff5f5;color:var(--red);}
.tier-btn.active.t2{background:var(--orange-bg);color:var(--orange);}
.tier-btn.active.t3{background:var(--green-bg);color:var(--green);}
.tier-info{padding:12px 16px;border-radius:7px;margin-bottom:16px;font-size:12px;}
.tier-info.t1{background:var(--red-bg);border:1px solid var(--red-border);color:var(--red);}
.tier-info.t2{background:var(--orange-bg);border:1px solid var(--orange-border);color:var(--orange);}
.tier-info.t3{background:var(--green-bg);border:1px solid var(--green-border);color:var(--green);}
.gdc-calc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}
.gdc-input-card{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:14px;}
.gdc-label{font-size:10px;font-family:'DM Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px;}
.gdc-input{width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:7px 10px;font-family:'DM Mono',monospace;font-size:13px;color:var(--text);outline:none;}
.gdc-input:focus{border-color:#bee3f8;}
.gdc-result{font-size:26px;font-weight:700;line-height:1;margin-top:5px;}
.gdc-sub{font-size:10px;color:var(--muted);margin-top:3px;}
.cases-table{width:100%;border-collapse:collapse;font-size:11px;}
.cases-table th{text-align:left;padding:7px 10px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg);}
.cases-table td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle;}
.cases-table tr:last-child td{border-bottom:none;}
.cases-table tr:hover td{background:var(--bg);}
.td-mono{font-family:'DM Mono',monospace;}
.td-green{color:var(--green);font-weight:600;}
.td-gold{color:var(--gold);}

/* NEEDS MAP */
.needs-map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;}
.needs-cohort{background:var(--card);border:1px solid var(--border);border-radius:7px;padding:12px;cursor:pointer;transition:all .15s;}
.needs-cohort:hover{border-color:#bee3f8;box-shadow:var(--shadow2);}
.nc-age{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:4px;}
.nc-name{font-size:12px;font-weight:600;margin-bottom:6px;}
.nc-products{display:flex;flex-wrap:wrap;gap:3px;}
.nc-tag{font-size:8px;padding:1px 5px;border-radius:3px;font-family:'DM Mono',monospace;}
.nct-life{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border);}
.nct-retire{background:var(--purple-bg);color:var(--purple);border:1px solid var(--purple-border);}
.nct-college{background:var(--teal-bg);color:var(--teal);border:1px solid var(--teal-border);}
.nct-emerg{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border);}

/* SALES CALC */
.sales-calc-wrap{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:20px;max-width:480px;}
.sc-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);}
.sc-row:last-child{border-bottom:none;}
.sc-label{font-size:12px;color:var(--text);font-weight:500;}
.sc-val{font-size:18px;font-weight:700;color:#2b6cb0;font-family:'DM Mono',monospace;}
.sc-val.large{font-size:26px;color:var(--green);}
.sc-input{width:100px;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:6px 10px;font-family:'DM Mono',monospace;font-size:13px;color:var(--text);outline:none;text-align:right;}
.sc-input:focus{border-color:#bee3f8;}

/* WORKSHOPS */
.workshop-card{background:var(--card);border:1px solid var(--border);border-radius:9px;padding:16px;margin-bottom:8px;box-shadow:var(--shadow);}
.wk-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
.wk-title{font-size:14px;font-weight:600;}
.wk-date{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);}
.wk-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;}
.wk-stat{background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:8px;text-align:center;}
.wk-stat-val{font-size:18px;font-weight:700;}
.wk-stat-lbl{font-size:9px;color:var(--muted);margin-top:1px;}
.wk-tags{display:flex;gap:5px;flex-wrap:wrap;}

/* TOAST */
.toast-wrap{position:fixed;bottom:18px;right:18px;z-index:999;display:flex;flex-direction:column;gap:7px;}
.toast{background:var(--navy);color:#fff;border-radius:7px;padding:9px 14px;font-size:11px;display:flex;align-items:center;gap:7px;min-width:220px;box-shadow:var(--shadow2);animation:toastIn .2s ease;}
@keyframes toastIn{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
.toast.success{border-left:3px solid #48bb78;}.toast.error{border-left:3px solid #e53e3e;}.toast.info{border-left:3px solid #4299e1;}

@media(max-width:1100px){.kpi-strip{grid-template-columns:repeat(3,1fr);}.main-grid{grid-template-columns:1fr 1fr;}.col:last-child{display:none;}.agents-grid{grid-template-columns:1fr;}}
@media(max-width:700px){.sidebar{display:none;}.kpi-strip{grid-template-columns:repeat(2,1fr);}.main-grid{grid-template-columns:1fr;}}

/* BUTTONS */
.btn-primary,.btn-secondary,.btn-gold,.btn-green{padding:8px 16px;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;border:1px solid transparent;}
.btn-primary{background:#2b6cb0;color:#fff;}.btn-primary:hover{background:#2c5282;}
.btn-secondary{background:var(--card);color:var(--text);border-color:var(--border);}.btn-secondary:hover{border-color:#bee3f8;color:#2b6cb0;background:var(--blue-bg);}
.btn-gold{background:var(--gold);color:#fff;}.btn-gold:hover{filter:brightness(.94);}
.btn-green{background:var(--green2);color:#fff;}.btn-green:hover{background:var(--green);}
.btn-primary:disabled,.btn-secondary:disabled,.btn-gold:disabled,.btn-green:disabled{opacity:.5;cursor:not-allowed;}

/* TABS */
.tab-bar{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border);}
.tab-btn{padding:9px 16px;border:none;background:none;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s;}
.tab-btn:hover{color:#2b6cb0;}
.tab-btn.active{color:#2b6cb0;border-bottom-color:#2b6cb0;font-weight:600;}

/* MODAL */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(15,30,54,.5);z-index:200;align-items:center;justify-content:center;padding:20px;}
.modal-overlay.open{display:flex;animation:toastIn .15s ease;}
.modal{background:var(--card);border-radius:11px;box-shadow:var(--shadow2);width:100%;max-width:460px;max-height:90vh;overflow-y:auto;padding:22px;}
.modal-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:16px;}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;}
.field{margin-bottom:12px;}
.field label{display:block;font-size:11px;font-weight:500;color:var(--muted);margin-bottom:5px;}
.field input,.field select,.field textarea{width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 11px;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--text);outline:none;}
.field input:focus,.field select:focus,.field textarea:focus{border-color:#bee3f8;}
.link-preview{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:9px 11px;font-family:'DM Mono',monospace;font-size:11px;color:#2b6cb0;word-break:break-all;display:flex;align-items:center;gap:8px;justify-content:space-between;}
.copy-btn{padding:5px 11px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;font-family:'DM Sans',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0;}
.copy-btn:hover{border-color:#bee3f8;color:#2b6cb0;}

/* FORMS LIBRARY */
.forms-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
.form-card{background:var(--card);border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;}
.form-card-head{display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid var(--border);background:var(--bg);}
.form-icon{width:34px;height:34px;border-radius:8px;background:var(--blue-bg);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.form-title{font-size:12px;font-weight:600;color:var(--text);}
.form-id{font-family:'DM Mono',monospace;font-size:9px;color:var(--dim);margin-top:1px;}
.form-card-body{padding:14px 15px;flex:1;display:flex;flex-direction:column;gap:10px;}
.form-desc{font-size:11px;color:var(--muted);line-height:1.5;flex:1;}
.form-meta{display:flex;gap:6px;flex-wrap:wrap;}
.fm-tag{font-size:8px;font-family:'DM Mono',monospace;padding:2px 6px;border-radius:3px;background:var(--bg2);color:var(--muted);text-transform:uppercase;letter-spacing:.05em;}

/* FNA */
.fna-wrap{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start;}
.fna-left{display:flex;flex-direction:column;gap:12px;}
.fna-card{background:var(--card);border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow);padding:16px;}
.fna-card-title{font-size:12px;font-weight:600;color:var(--text);margin-bottom:12px;}
.fna-report{background:var(--card);border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow);padding:22px;min-height:300px;}
.loading-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:60px 20px;color:var(--muted);font-size:12px;}
.loading-spinner{width:32px;height:32px;border:3px solid var(--border);border-top-color:#2b6cb0;border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.report-header{border-bottom:2px solid var(--navy);padding-bottom:12px;margin-bottom:16px;}
.report-title{font-size:18px;font-weight:700;color:var(--navy);}
.report-sub{font-size:11px;color:var(--muted);margin-top:3px;}
.report-section{margin-bottom:18px;}
.rs-title{font-size:11px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.08em;color:#2b6cb0;font-weight:600;margin-bottom:8px;}
.rs-content{font-size:13px;color:var(--text);line-height:1.65;}
.rs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}
.rs-item{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;}
.rs-item-label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;}
.rs-item-val{font-size:15px;font-weight:700;color:var(--text);}
.priority-rec{display:flex;gap:11px;padding:11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);margin-bottom:8px;}
.pr-num{width:22px;height:22px;border-radius:50%;background:#2b6cb0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;}
.pr-title{font-size:12px;font-weight:600;color:var(--text);margin-bottom:2px;}
.pr-body{font-size:11px;color:var(--muted);line-height:1.5;}
.disclaimer{background:var(--gold-bg);border:1px solid var(--gold-border);border-radius:6px;padding:11px 13px;font-size:10px;color:var(--gold);line-height:1.5;margin-top:16px;}

/* RESPONSES TABLE */
.resp-table{width:100%;border-collapse:collapse;font-size:11px;}
.resp-table th{text-align:left;padding:8px 10px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg);}
.resp-table td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:middle;}
.resp-table tr:last-child td{border-bottom:none;}
.resp-table tr:hover td{background:var(--bg);}
.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;}
.status-dot.complete{background:var(--green2);}
.status-dot.opened{background:var(--blue);}
.status-dot.sent{background:var(--orange);}
.status-dot.expired{background:var(--dim);}

/* MISC */
.page-sub{font-size:12px;color:var(--muted);margin:-8px 0 16px;}
.sp-issued{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border);}
.empty-state{text-align:center;padding:48px 20px;color:var(--muted);}
.empty-state-icon{font-size:34px;margin-bottom:10px;opacity:.5;}
.empty-state-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:5px;}
.empty-state-sub{font-size:12px;color:var(--muted);}
.error-banner{background:var(--red-bg);border:1px solid var(--red-border);color:var(--red);border-radius:7px;padding:11px 15px;margin-bottom:14px;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;}
.error-banner button{background:var(--red);color:#fff;border:none;border-radius:5px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;}

/* AI ASSISTANT */
.agents-box.clickable{cursor:pointer;transition:background .15s;}
.agents-box.clickable:hover{background:rgba(255,255,255,.09);}
.ab-open{font-size:8px;color:#4299e1;margin-top:6px;font-family:'DM Mono',monospace;letter-spacing:.05em;}
.asst-overlay{position:fixed;inset:0;background:rgba(15,30,54,.5);z-index:300;display:flex;align-items:flex-end;justify-content:flex-end;padding:0;}
.asst-panel{background:var(--card);width:100%;max-width:420px;height:100vh;display:flex;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,.18);animation:asstIn .2s ease;}
@keyframes asstIn{from{transform:translateX(24px);opacity:0}to{transform:translateX(0);opacity:1}}
.asst-head{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;background:var(--navy);color:#fff;}
.asst-head-title{font-size:14px;font-weight:600;}
.asst-head-sub{font-size:10px;color:rgba(255,255,255,.5);margin-top:1px;}
.asst-close{background:rgba(255,255,255,.1);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:15px;line-height:1;}
.asst-close:hover{background:rgba(255,255,255,.2);}
.asst-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--bg);}
.asst-msg{max-width:88%;padding:10px 13px;border-radius:11px;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;}
.asst-msg.user{align-self:flex-end;background:#2b6cb0;color:#fff;border-bottom-right-radius:3px;}
.asst-msg.assistant{align-self:flex-start;background:var(--card);color:var(--text);border:1px solid var(--border);border-bottom-left-radius:3px;}
.asst-hint{align-self:flex-start;font-size:11px;color:var(--muted);line-height:1.5;background:var(--card);border:1px solid var(--border);border-radius:11px;padding:12px 14px;}
.asst-chip{display:inline-block;margin:4px 4px 0 0;padding:4px 10px;border:1px solid var(--border);border-radius:14px;background:var(--card);color:#2b6cb0;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;}
.asst-chip:hover{background:var(--blue-bg);}
.asst-typing{align-self:flex-start;color:var(--muted);font-size:11px;font-style:italic;}
.asst-foot{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);background:var(--card);}
.asst-input{flex:1;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--text);outline:none;resize:none;max-height:110px;}
.asst-input:focus{border-color:#bee3f8;}
.asst-send{background:#2b6cb0;color:#fff;border:none;border-radius:8px;padding:0 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;}
.asst-send:disabled{opacity:.5;cursor:not-allowed;}

`;

const today = new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
const ini = n=>n.split(" ").map(x=>x[0]).join("").slice(0,2);
const fmtD = n=>n==null?"—":"$"+Math.round(n).toLocaleString("en-US");
const fmtPct = n=>(n*100).toFixed(2)+"%";
const toTel = s=>s ? s.split("").filter(c=>"0123456789".includes(c)).join("") : "";

// GDC TIER LOGIC — corrected from flat 80% to tiered structure per FFS Commission Grid
const TIERS = [
  {id:1, label:"Tier 1", range:"Under $14,999 GDC", rate:0.40, rateLabel:"40%", cls:"t1", color:"#e53e3e"},
  {id:2, label:"Tier 2", range:"$15,000–$54,999 GDC", rate:0.60, rateLabel:"60%", cls:"t2", color:"#dd6b20"},
  {id:3, label:"Tier 3", range:"$55,000+ GDC", rate:0.80, rateLabel:"80%", cls:"t3", color:"#276749"},
];

// FFS KEY CONTACTS from Resource Directory
const FFS_CONTACTS = [
  {name:"Matt Anderson", role:"FSD — Central (TX)", tel:"(818) 584-0264"},
  {name:"Ando Agamalian", role:"Internal Wholesaler", tel:"(818) 584-0205"},
  {name:"Ryan Anderson", role:"Compliance — TX", tel:"(253) 242-0597"},
  {name:"Lora Brandt", role:"OSJ Principal Mgr.", tel:"(818) 584-0199"},
  {name:"Sales Desk", role:"(866) 888-9739 Opt 3→3", tel:"Mon-Fri 7AM-5PM PT"},
];

// CUSTOMER NEEDS MAP from Financial Reviews guide (32-9913)
const NEEDS_MAP = [
  {cohort:"Just Starting Out", age:"20–30", products:["Term","Emergency","Roth IRA"]},
  {cohort:"Starting a Family", age:"30–40", products:["Term/Perm","VUL","Emergency","Roth","IRA","Rollover","529"]},
  {cohort:"Maturing Family", age:"40–50", products:["VUL","Emergency","Roth","IRA","Rollover","Indexed Ann.","VA","529"]},
  {cohort:"Empty Nesters", age:"50–60", products:["VUL","Emergency","Roth","IRA","Rollover","Indexed Ann.","VA"]},
  {cohort:"Nearing Retirement", age:"60–70", products:["VUL","Emergency","Roth","IRA","Rollover","Indexed Ann.","VA"]},
  {cohort:"Retirement Prime", age:"70–80", products:["Emergency","Indexed Ann.","VA","VUL"]},
  {cohort:"Later Retirement", age:"80+", products:["Emergency","Indexed Ann.","VA","VUL"]},
];

const numColors=["#e53e3e","#553c9a","#dd6b20","#2b6cb0","#38a169","#0a5060"];
// Hoisted to module scope — referenced by Dashboard (priority list) and Daily
// Briefing (top opportunities). Was previously only a local const inside
// OpportunityDashboard, which threw a ReferenceError once live data rendered.
const actionLabel={CONV:"Conversion",OPRA:"OPRA",LIFE:"Life Review",RETIRE:"Retirement",BIZ:"Business Owner"};

function Donut({segs,total}){
  const r=52,cx=60,cy=60,circ=2*Math.PI*r;let off=0;
  const s2=segs.map(s=>{const pct=s.v/total,stroke=pct*circ,gap=circ-stroke,da=`${stroke} ${gap}`,do_=-off;off+=stroke;return{...s,da,do_};});
  return(<div className="donut-wrap">
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg2)" strokeWidth="14"/>
      {s2.map((s,i)=>(<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={s.da} strokeDashoffset={s.do_} style={{transform:"rotate(-90deg)",transformOrigin:"60px 60px"}}/>))}
      <text x={cx} y={cy-4} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text)" fontFamily="DM Sans">{total}</text>
      <text x={cx} y={cy+14} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="DM Mono" letterSpacing="1">TOTAL</text>
    </svg>
    <div>{s2.map((s,i)=>(<div className="legend-item" key={i}><div className="ldot" style={{background:s.color}}/><div className="llabel">{s.label}</div><div className="lval">{s.v} ({Math.round(s.v/total*100)}%)</div></div>))}</div>
  </div>);
}

function GDCPage({tier,setTier,toast,appData={}}){
  const [premium,setPremium]=useState("");
  const [gdcRate,setGdcRate]=useState("");
  const t=TIERS[tier-1];
  const prem=parseFloat(premium)||0;
  const rate=parseFloat(gdcRate)/100||0;
  const estGDC=prem*rate;
  const estFSA=estGDC*t.rate;

  // ── Live commission cases ──────────────────────────────
  const [cases, setCases] = useState([]);
  const [summary, setSummary] = useState(null);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesError, setCasesError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [newCase, setNewCase] = useState({carrier:"",product_name:"",product_type:"fia",premium:"",client_age:"",state_code:"TX",pipeline:"general",notes:""});
  const [saving, setSaving] = useState(false);

  const refreshCases = useCallback(() => {
    setCasesLoading(true); setCasesError(null);
    fetch("/api/gdc/cases?limit=100")
      .then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(d=>{ setCases(d.cases||[]); setSummary(d.summary||null); setCasesLoading(false); })
      .catch(e=>{ setCasesError(e.message||"Failed to load"); setCasesLoading(false); });
  }, []);
  useEffect(()=>{ refreshCases(); },[refreshCases]);

  const STATUS_ORDER = ["pending","submitted","issued","paid"];
  const statusStyle = (s)=>({
    pending:{bg:"#edf0f4",color:"#6b7a8d"},
    submitted:{bg:"var(--blue-bg)",color:"#2b6cb0"},
    issued:{bg:"var(--green-bg)",color:"var(--green)"},
    paid:{bg:"#fdf6e3",color:"#b7791f"},
    cancelled:{bg:"var(--red-bg)",color:"var(--red)"},
    flagged:{bg:"var(--red-bg)",color:"var(--red)"},
  }[s]||{bg:"#edf0f4",color:"#6b7a8d"});

  const cycleStatus = async (c)=>{
    const idx = STATUS_ORDER.indexOf(c.case_status);
    const next = idx>=0 && idx<STATUS_ORDER.length-1 ? STATUS_ORDER[idx+1] : STATUS_ORDER[0];
    const body = {case_id:c.case_id, case_status:next};
    if(next==="issued") body.issued_date = new Date().toISOString().split("T")[0];
    if(next==="paid") body.paid_date = new Date().toISOString().split("T")[0];
    if(next==="submitted") body.submitted_at = new Date().toISOString();
    try{
      const res = await fetch("/api/gdc/cases",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const d = await res.json();
      if(d.success){ toast(`Case → ${next}`,"success"); refreshCases(); }
      else toast(d.error||"Update failed","error");
    }catch{ toast("Network error","error"); }
  };

  const submitNewCase = async ()=>{
    if(!newCase.carrier||!newCase.product_name){ toast("Carrier and product required","error"); return; }
    setSaving(true);
    try{
      const res = await fetch("/api/gdc/cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        ...newCase,
        premium: parseFloat(newCase.premium)||null,
        client_age: parseInt(newCase.client_age)||null,
      })});
      const d = await res.json();
      if(d.success){ toast("Case logged","success"); setShowModal(false); setNewCase({carrier:"",product_name:"",product_type:"fia",premium:"",client_age:"",state_code:"TX",pipeline:"general",notes:""}); refreshCases(); }
      else toast(d.error||"Failed to log case","error");
    }catch{ toast("Network error","error"); }
    finally{ setSaving(false); }
  };

  const totalGDC = summary ? summary.total_pipeline : (appData.gdc?.pipeline || 0);
  const totalFSA = totalGDC*t.rate;
  return(<>
    <div className="page-title">GDC & Commission — Tier-Aware Calculator</div>

    {/* Live summary strip */}
    {summary && (
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[
          {l:"Issued GDC (YTD)",v:fmtD(summary.total_issued_ytd),c:"var(--green2)"},
          {l:"Pipeline GDC",v:fmtD(summary.total_pipeline),c:"#2b6cb0"},
          {l:"FSA Payout (YTD)",v:fmtD(summary.total_fsa_ytd),c:"var(--orange)"},
          {l:`Current Tier`,v:`Tier ${summary.tier} · ${Math.round(summary.tier_rate*100)}%`,c:"var(--purple)"},
        ].map((s,i)=>(
          <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"14px 16px",boxShadow:"var(--shadow)"}}>
            <div style={{fontSize:10,color:"var(--muted)",marginBottom:5}}>{s.l}</div>
            <div style={{fontSize:20,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
          </div>
        ))}
      </div>
    )}
    <div style={{background:"var(--red-bg)",border:"1px solid var(--red-border)",borderRadius:7,padding:"12px 16px",marginBottom:16,fontSize:12,color:"var(--red)"}}>
      ⚠ Your FSA payout is tiered by rolling 12-month GDC — not a flat rate. Select your current tier below. <strong>Tier 1 = 40%, Tier 2 = 60%, Tier 3 = 80%.</strong>
    </div>
    <div className="tier-selector">
      {TIERS.map(t=><button key={t.id} className={`tier-btn ${tier===t.id?`active ${t.cls}`:""}`} onClick={()=>setTier(t.id)}>
        <div style={{fontWeight:600}}>{t.label}</div>
        <div style={{fontSize:10,marginTop:2}}>{t.range}</div>
        <div style={{fontSize:14,fontWeight:700,marginTop:3}}>{t.rateLabel}</div>
      </button>)}
    </div>
    <div className={`tier-info ${TIERS[tier-1].cls}`}>
      Currently on <strong>{TIERS[tier-1].label}</strong> — {TIERS[tier-1].range} rolling 12-month GDC → <strong>{TIERS[tier-1].rateLabel} FSA payout</strong>
    </div>
    <div className="gdc-calc-grid">
      <div className="gdc-input-card">
        <div className="gdc-label">Premium / Contribution ($)</div>
        <input className="gdc-input" type="number" value={premium} onChange={e=>setPremium(e.target.value)} placeholder="e.g. 150000"/>
        <div className="gdc-label" style={{marginTop:10}}>GDC Rate (% from FFS schedule)</div>
        <input className="gdc-input" type="number" value={gdcRate} onChange={e=>setGdcRate(e.target.value)} placeholder="e.g. 7.00" step="0.01"/>
      </div>
      <div className="gdc-input-card">
        <div className="gdc-label">Estimated GDC</div>
        <div className="gdc-result" style={{color:"#2b6cb0"}}>{estGDC>0?fmtD(estGDC):"—"}</div>
        <div className="gdc-sub">Premium × GDC Rate</div>
        <div className="gdc-label" style={{marginTop:10}}>Estimated FSA Payout ({TIERS[tier-1].rateLabel})</div>
        <div className="gdc-result" style={{color:TIERS[tier-1].color}}>{estFSA>0?fmtD(estFSA):"—"}</div>
        <div className="gdc-sub">GDC × {TIERS[tier-1].rateLabel}</div>
      </div>
      <div className="gdc-input-card">
        <div className="gdc-label">Pipeline GDC (active cases)</div>
        <div className="gdc-result" style={{color:"#2b6cb0",fontSize:20}}>{fmtD(totalGDC)}</div>
        <div className="gdc-label" style={{marginTop:8}}>Pipeline FSA ({TIERS[tier-1].rateLabel})</div>
        <div className="gdc-result" style={{color:TIERS[tier-1].color,fontSize:20}}>{fmtD(totalFSA)}</div>
        <div className="gdc-sub">At current tier</div>
      </div>
    </div>
    {casesError && <div className="error-banner"><span>⚠ Couldn't load commission cases ({casesError}).</span><button onClick={refreshCases}>Retry</button></div>}
    <div className="card">
      <div className="card-head">
        <div className="card-title">Active Cases {casesLoading && <span style={{fontSize:10,color:"var(--muted)",fontWeight:400}}>· loading…</span>}</div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn-secondary" style={{fontSize:10,padding:"4px 10px"}} onClick={refreshCases}>↻ Refresh</button>
          <button className="btn-primary" style={{fontSize:10,padding:"4px 12px"}} onClick={()=>setShowModal(true)}>+ Log New Case</button>
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table className="cases-table">
          <thead><tr><th>Client</th><th>Carrier</th><th>Product</th><th>Type</th><th>Premium</th><th>GDC Rate</th><th>Est. GDC</th><th>FSA</th><th>Issued Date</th><th>Paid Date</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{cases.length===0 ? (
            <tr><td colSpan={12} style={{padding:0}}>
              <div className="empty-state" style={{padding:"32px 20px"}}>
                <div className="empty-state-icon">💰</div>
                <div className="empty-state-title">{casesLoading?"Loading cases…":"No active cases yet"}</div>
                <div className="empty-state-sub">{casesLoading?"":"Log a case with “+ Log New Case” to start tracking GDC."}</div>
              </div>
            </td></tr>
          ) : cases.map((c)=>{
            const name = `${c.customers?.first_name||""} ${c.customers?.last_name||""}`.trim() || "—";
            const ss = statusStyle(c.case_status);
            return(<tr key={c.case_id}>
              <td style={{fontWeight:500}}>{name}</td>
              <td className="td-mono" style={{color:"var(--muted)",fontSize:10}}>{c.carrier||"—"}</td>
              <td className="td-mono" style={{color:"var(--muted)"}}>{c.product_name}</td>
              <td><span className="sp sp-submitted">{(c.product_type||"").toUpperCase()}</span></td>
              <td className="td-mono">{fmtD(c.premium)}</td>
              <td className="td-gold td-mono">{c.gdc_rate_used?fmtPct(c.gdc_rate_used):<span style={{color:"var(--red)"}}>MISSING</span>}</td>
              <td className="td-mono" style={{color:"#2b6cb0"}}>{fmtD(c.estimated_gdc)}</td>
              <td className="td-green td-mono">{fmtD(c.estimated_fsa)}</td>
              <td className="td-mono" style={{fontSize:10,color:c.issued_date?"var(--green2)":"var(--dim)"}}>{c.issued_date||"—"}</td>
              <td className="td-mono" style={{fontSize:10,color:c.paid_date?"var(--green2)":"var(--dim)"}}>{c.paid_date||"—"}</td>
              <td><button onClick={()=>cycleStatus(c)} title="Click to advance status" style={{cursor:"pointer",border:"none",borderRadius:4,padding:"3px 9px",fontSize:10,fontWeight:600,fontFamily:"DM Mono,monospace",background:ss.bg,color:ss.color}}>{c.case_status}</button></td>
              <td><button style={{fontSize:9,padding:"2px 7px",borderRadius:3,border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",cursor:"pointer"}} onClick={()=>cycleStatus(c)}>→ Next</button></td>
            </tr>);
          })}</tbody>
        </table>
      </div>
    </div>

    {/* Log New Case modal */}
    {showModal && (
      <div onClick={()=>setShowModal(false)} style={{position:"fixed",inset:0,background:"rgba(15,30,54,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:12,padding:24,width:"100%",maxWidth:440,boxShadow:"0 12px 40px rgba(0,0,0,.25)",maxHeight:"90vh",overflow:"auto"}}>
          <div style={{fontSize:16,fontWeight:700,color:"var(--navy)",marginBottom:16}}>Log New Commission Case</div>
          {[
            {k:"carrier",l:"Carrier *",ph:"e.g. Athene"},
            {k:"product_name",l:"Product Name *",ph:"e.g. Agility 10"},
          ].map(f=>(
            <div key={f.k} style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--muted)",marginBottom:4}}>{f.l}</label>
              <input value={newCase[f.k]} placeholder={f.ph} onChange={e=>setNewCase(n=>({...n,[f.k]:e.target.value}))}
                style={{width:"100%",padding:"9px 11px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}/>
            </div>
          ))}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--muted)",marginBottom:4}}>Product Type</label>
              <select value={newCase.product_type} onChange={e=>setNewCase(n=>({...n,product_type:e.target.value}))} style={{width:"100%",padding:"9px 11px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}>
                {["fia","life","ira","mf","annuity","ul","term"].map(o=><option key={o} value={o}>{o.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--muted)",marginBottom:4}}>Pipeline</label>
              <select value={newCase.pipeline} onChange={e=>setNewCase(n=>({...n,pipeline:e.target.value}))} style={{width:"100%",padding:"9px 11px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}>
                {["general","opra","conversions","life","retirement","business"].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--muted)",marginBottom:4}}>Premium ($)</label>
              <input type="number" value={newCase.premium} onChange={e=>setNewCase(n=>({...n,premium:e.target.value}))} style={{width:"100%",padding:"9px 11px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}/>
            </div>
            <div>
              <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--muted)",marginBottom:4}}>Client Age</label>
              <input type="number" value={newCase.client_age} onChange={e=>setNewCase(n=>({...n,client_age:e.target.value}))} style={{width:"100%",padding:"9px 11px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}/>
            </div>
          </div>
          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--muted)",marginBottom:4}}>Notes</label>
            <textarea value={newCase.notes} onChange={e=>setNewCase(n=>({...n,notes:e.target.value}))} rows={2} style={{width:"100%",padding:"9px 11px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,boxSizing:"border-box",fontFamily:"inherit",resize:"vertical"}}/>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button className="btn-secondary" style={{fontSize:12,padding:"8px 16px"}} onClick={()=>setShowModal(false)}>Cancel</button>
            <button className="btn-primary" style={{fontSize:12,padding:"8px 16px"}} disabled={saving} onClick={submitNewCase}>{saving?"Saving…":"Log Case"}</button>
          </div>
        </div>
      </div>
    )}
  </>);
}

function NeedsMapPage({toast}){
  const [selected,setSelected]=useState(null);
  const tagCls={Term:"nct-life","Term/Perm":"nct-life",VUL:"nct-life",Emergency:"nct-emerg","Roth IRA":"nct-retire",Roth:"nct-retire","IRA":"nct-retire","Rollover":"nct-retire","Indexed Ann.":"nct-retire","VA":"nct-retire","529":"nct-college"};
  return(<>
    <div className="page-title">Customer Needs Map</div>
    <div style={{fontSize:12,color:"var(--muted)",marginBottom:16}}>From FFS Financial Reviews guide (32-9913). Age cohort → recommended products. Use this to align meeting prep with the right product conversation before every appointment.</div>
    <div className="needs-map-grid">
      {NEEDS_MAP.map((c,i)=><div className={`needs-cohort${selected===i?" card":"card"}`} key={i} style={{border:`1px solid ${selected===i?"#bee3f8":"var(--border)"}`,boxShadow:selected===i?"0 4px 12px rgba(0,0,0,.1)":"none"}} onClick={()=>setSelected(selected===i?null:i)}>
        <div className="nc-age">{c.age}</div>
        <div className="nc-name">{c.cohort}</div>
        <div className="nc-products">
          {c.products.map((p,j)=><span key={j} className={`nc-tag ${tagCls[p]||"nct-emerg"}`}>{p}</span>)}
        </div>
      </div>)}
    </div>
    {selected!==null&&<div style={{background:"var(--blue-bg)",border:"1px solid var(--blue-border)",borderRadius:9,padding:16,marginTop:12}}>
      <div style={{fontWeight:600,marginBottom:6}}>{NEEDS_MAP[selected].cohort} — Scoring Signal</div>
      <div style={{fontSize:12,color:"var(--muted)"}}>Customer in age band <strong>{NEEDS_MAP[selected].age}</strong> missing any of: {NEEDS_MAP[selected].products.join(", ")} → flag as opportunity in Supabase and route to the correct pipeline. Call FFS Sales Desk (866) 888-9739 Opt 3→3 before presenting.</div>
    </div>}
  </>);
}

function SalesCalcPage(){
  const [goal,setGoal]=useState("");
  const [tier,setTier]=useState(3);
  const t=TIERS[tier-1];
  const gdc=parseFloat(goal)||0;
  const apps=Math.ceil(gdc/30000);
  const appts=Math.ceil(apps*3);
  const introYear=Math.ceil(appts*10);
  const introWeek=Math.ceil(introYear/52);
  const introDay=Math.ceil(introYear/260);
  const fsa=gdc*t.rate;
  return(<>
    <div className="page-title">Sales Activity Calculator — 10-3-1 Model</div>
    <div style={{fontSize:12,color:"var(--muted)",marginBottom:16}}>From FFS form 318551. Work backwards from your GDC goal to daily activity needed. Based on Al Granum's 10-3-1 rule: 10 introductions → 3 appointments → 1 sale.</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <div className="sales-calc-wrap">
        <div style={{fontWeight:600,marginBottom:14,fontSize:14}}>By GDC Goal</div>
        <div className="sc-row">
          <div className="sc-label">GDC Goal (rolling 12-mo)</div>
          <input className="sc-input" type="number" value={goal} onChange={e=>setGoal(e.target.value)} placeholder="55000"/>
        </div>
        <div className="sc-row">
          <div className="sc-label">Payout Tier</div>
          <select style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:4,padding:"5px 8px",fontSize:11,fontFamily:"DM Mono"}} value={tier} onChange={e=>setTier(Number(e.target.value))}>
            {TIERS.map(t=><option key={t.id} value={t.id}>{t.label} ({t.rateLabel})</option>)}
          </select>
        </div>
        <div className="sc-row"><div className="sc-label">Est. FSA Payout</div><div className="sc-val large">{fsa>0?fmtD(fsa):"—"}</div></div>
        <div className="sc-row"><div className="sc-label">Applications needed</div><div className="sc-val">{apps||"—"}</div></div>
        <div className="sc-row"><div className="sc-label">Appointments needed</div><div className="sc-val">{appts||"—"}</div></div>
        <div className="sc-row"><div className="sc-label">Introductions / year</div><div className="sc-val">{introYear||"—"}</div></div>
        <div className="sc-row"><div className="sc-label">Introductions / week</div><div className="sc-val">{introWeek||"—"}</div></div>
        <div className="sc-row"><div className="sc-label">Introductions / day</div><div className="sc-val">{introDay||"—"}</div></div>
      </div>
      <div>
        <div className="card" style={{padding:16,marginBottom:12}}>
          <div style={{fontWeight:600,marginBottom:8,fontSize:13}}>Tier thresholds (FFS Commission Grid)</div>
          {TIERS.map(t=><div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:12}}>
            <span style={{color:"var(--muted)"}}>{t.label} — {t.range}</span>
            <span style={{fontWeight:600,color:t.color}}>{t.rateLabel} payout</span>
          </div>)}
        </div>
        <div style={{background:"var(--navy)",color:"#fff",borderRadius:9,padding:16,fontSize:12}}>
          <div style={{fontWeight:600,marginBottom:8}}>To reach Tier 3 ($55k GDC) at typical case sizes:</div>
          <div style={{color:"rgba(255,255,255,.7)",lineHeight:1.8}}>
            At $30k avg GDC per case → <strong style={{color:"#fff"}}>2 cases</strong> to hit Tier 3<br/>
            At $10k avg GDC per case → <strong style={{color:"#fff"}}>6 cases</strong> to hit Tier 3<br/>
            <span style={{color:"rgba(255,255,255,.5)",fontSize:10}}>Rolling 12-month. Excludes 12b1 trails.</span>
          </div>
        </div>
      </div>
    </div>
  </>);
}

function WorkshopsPage({toast}){
  const [workshops, setWorkshops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    fetch("/api/dashboard?scope=workshops")
      .then(r => { if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(d => {
        setWorkshops((d.workshops || []).map(w => ({
          title: w.title,
          date: `${w.scheduled_at?new Date(w.scheduled_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"TBD"} · ${w.location||"TBD"}`,
          registered: w.registered_count || 0,
          attended: w.attended_count || null,
          hot: w.hot_leads || null,
          booked: w.appointments_booked || null,
          topic: w.topic,
        })));
        setLoading(false);
      })
      .catch(e => { setError(e.message||"Failed to load"); setLoading(false); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return(<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
      <div className="page-title" style={{marginBottom:0}}>Workshops</div>
      <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={refresh}>↻ Refresh</button>
    </div>
    {error && <div className="error-banner"><span>⚠ Couldn't load workshops ({error}).</span><button onClick={refresh}>Retry</button></div>}
    {loading && <div className="loading-state"><div className="loading-spinner"/><div>Loading workshops…</div></div>}
    {!loading && !error && workshops.length===0 && (
      <div className="empty-state">
        <div className="empty-state-icon">🎓</div>
        <div className="empty-state-title">No workshops scheduled yet</div>
        <div className="empty-state-sub">Scheduled workshops and their registration stats will appear here.</div>
      </div>
    )}
    {workshops.map((w,i)=><div className="workshop-card" key={i}>
      <div className="wk-head">
        <div><div className="wk-title">{w.title}</div><div className="wk-date">{w.date}</div></div>
      </div>
      <div className="wk-stats">
        <div className="wk-stat"><div className="wk-stat-val" style={{color:"#2b6cb0"}}>{w.registered}</div><div className="wk-stat-lbl">Registered</div></div>
        <div className="wk-stat"><div className="wk-stat-val" style={{color:w.attended?"#38a169":"var(--muted)"}}>{w.attended??"-"}</div><div className="wk-stat-lbl">Attended</div></div>
        <div className="wk-stat"><div className="wk-stat-val" style={{color:w.hot?"#e53e3e":"var(--muted)"}}>{w.hot??"-"}</div><div className="wk-stat-lbl">Hot Leads</div></div>
        <div className="wk-stat"><div className="wk-stat-val" style={{color:w.booked?"#38a169":"var(--muted)"}}>{w.booked??"-"}</div><div className="wk-stat-lbl">1-on-1 Booked</div></div>
      </div>
      <div className="wk-tags">
        <span className={`ai-tag ${w.registered>20?"green":""}`}>{w.registered} registrants</span>
        {w.topic==="retire"&&<span className="ai-tag purple">Retirement audience</span>}
        {w.topic==="life"&&<span className="ai-tag">Life audience</span>}
      </div>
    </div>)}
  </>);
}

function Dashboard({onNav,toast,appData={}}){
  const { topOpportunities=[], counts={}, gdc={}, urgentConversions=[], opraDue=[], recentReferrals=[], loading=false } = appData;

  // Derive pipeline breakdown from live scores
  const byPipeline = topOpportunities.reduce((acc,o)=>{ const p=o.primary_pipeline||"general"; acc[p]=(acc[p]||0)+1; return acc; },{});
  const gdcTier = gdc.tier_label || "—";
  const gdcYTD  = gdc.issued_ytd || 0;
  const gdcPipe = gdc.pipeline || 0;

  return(<>
    <div className="kpi-strip">
      {[
        {label:"Today's Opportunities",val:topOpportunities.length||0,delta:loading?"Loading…":"Live from DB",dir:"up",icon:"🎯",bg:"#ebf8ff"},
        {label:"OPRA Cases",val:opraDue.length||0,delta:`${opraDue.filter(c=>!c.contacted).length} not contacted`,dir:opraDue.length>0?"down":"up",icon:"👥",bg:"#faf5ff"},
        {label:"Urgent Conversions",val:counts.urgent_conversions||0,delta:"≤ 30 days",dir:counts.urgent_conversions>0?"down":"up",icon:"⏰",bg:"#fffff0"},
        {label:"Life Pipeline",val:byPipeline["life"]||0,delta:"Scored customers",dir:"up",icon:"💚",bg:"#f0fff4"},
        {label:"Retirement Pipeline",val:byPipeline["retirement"]||0,delta:"Scored customers",dir:"up",icon:"📊",bg:"#ebf8ff"},
        {label:"GDC YTD",val:gdcYTD>0?"$"+(gdcYTD/1000).toFixed(0)+"k":"$0",delta:gdcTier,dir:"up",icon:"💰",bg:"#fffff0"},
      ].map((k,i)=>(
        <div className="kpi-card" key={i}>
          <div><div className="kpi-label">{k.label}</div><div className="kpi-val">{k.val}</div><div className={`kpi-delta ${k.dir}`}>{k.delta}</div></div>
          <div className="kpi-icon" style={{background:k.bg}}>{k.icon}</div>
        </div>
      ))}
    </div>
    <div className="main-grid">
      <div className="col">
        {/* LIVE BRIEFING STRIP */}
        <div style={{background:"var(--navy)",borderRadius:9,padding:"12px 16px",marginBottom:14,display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {[
            {icon:"⏰",label:"Urgent Conversions",val:counts.urgent_conversions||0,color:"#f0b429"},
            {icon:"📅",label:"Pending Forms",val:counts.pending_forms||0,color:"#4299e1"},
            {icon:"📣",label:"New Referrals (7d)",val:recentReferrals.length||0,color:"#9b72ff"},
            {icon:"🔄",label:"OPRA Due",val:counts.opra_due||0,color:"#48bb78"}
          ].map((s,i)=>(
            <div key={i} style={{textAlign:"center"}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,.45)",fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{s.label}</div>
              <div style={{fontSize:24,fontWeight:700,color:s.color,lineHeight:1}}>{s.val}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">🔥 Priority Actions</div><button className="card-link" onClick={()=>onNav("opps")}>View All →</button></div>
          <div className="card-body">
            {loading && <div style={{padding:"20px",textAlign:"center",color:"var(--muted)",fontSize:12}}>Loading live data…</div>}
            {!loading && topOpportunities.slice(0,4).map((o,i)=>{
              const name = `${o.customers?.first_name||""} ${o.customers?.last_name||""}`.trim()||"Unknown";
              const agency = o.customers?.agencies?.name||"—";
              const pipeline = o.primary_pipeline||"general";
              const pipeMap = {conversions:"CONV",opra:"OPRA",life:"LIFE",retirement:"RETIRE",business:"BIZ"};
              const action = pipeMap[pipeline]||"LIFE";
              const biz = pipeline==="business";
              return(
                <div className="priority-item" key={i} onClick={()=>toast(`Opening ${name}`,"info")}>
                  <div className="p-num" style={{background:numColors[i]}}>{i+1}</div>
                  <div className={`p-avatar${biz?" biz":""}`}>{ini(name)}</div>
                  <div className="p-info">
                    <div className="p-name">{name}
                      <span className={`pbadge ${o.priority_score>=75?"hi":o.priority_score>=50?"md":"lo"}`}>
                        {o.priority_score>=75?"HIGH":o.priority_score>=50?"MED":"LOW"}
                      </span>
                    </div>
                    <div className="p-reason">{actionLabel[action]||pipeline} opportunity</div>
                    <div className="p-meta"><span>Agency: {agency}</span></div>
                  </div>
                  <div className="p-right">
                    <div><div className="score-v">{o.priority_score||0}</div><div className="score-l">Score</div></div>
                    <button className="view-btn" onClick={e=>{e.stopPropagation();toast(`Viewing ${name}`,"info");}}>View</button>
                  </div>
                </div>
              );
            })}
            {!loading && topOpportunities.length===0 && <div style={{padding:"20px",textAlign:"center",color:"var(--muted)",fontSize:12}}>No scored opportunities yet. Run nightly scoring or add customers.</div>}
            <div className="view-all"><button className="view-all-btn" onClick={()=>onNav("opps")}>View All Priority Actions →</button></div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">🤖 AI Activity Today</div><button className="card-link" onClick={()=>onNav("ai")}>Report →</button></div>
          <div className="card-body">
            <div className="ai-stat-grid">
              {[
                {icon:"📞",val:appData.briefing?.ai_calls_made??0,lbl:"Calls Made"},
                {icon:"💬",val:appData.briefing?.ai_texts_sent??0,lbl:"Texts Sent"},
                {icon:"📧",val:appData.briefing?.ai_emails_sent??0,lbl:"Emails Sent"},
                {icon:"📅",val:appData.briefing?.ai_appointments_booked??0,lbl:"Appointments Booked"}
              ].map((s,i)=>(
                <div className="ai-stat" key={i}><div className="ai-stat-icon">{s.icon}</div><div className="ai-stat-val">{s.val}</div><div className="ai-stat-lbl">{s.lbl}</div></div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="col">
        <div className="card">
          <div className="card-head"><div className="card-title">📋 Pending Forms</div><button className="card-link" onClick={()=>onNav("forms")}>All Forms →</button></div>
          <div className="card-body" style={{padding:"6px 14px"}}>
            {loading && <div style={{padding:"16px",textAlign:"center",color:"var(--muted)",fontSize:12}}>Loading…</div>}
            {!loading && appData.pendingForms.slice(0,5).map((f,i)=>{
              const name = f.customers ? `${f.customers.first_name||""} ${f.customers.last_name||""}`.trim() : "Unknown";
              return(
                <div className="appt-item" key={i}>
                  <div className="appt-time" style={{width:60}}>{new Date(f.sent_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                  <div className="cal-dot" style={{background:"#4299e1",marginTop:3}}/>
                  <div className="appt-info">
                    <div className="appt-name">{name}</div>
                    <div className="appt-sub">{f.form_title}</div>
                  </div>
                  <span className="form-badge fb-pending">Pending ⚠</span>
                </div>
              );
            })}
            {!loading && appData.pendingForms.length===0 && <div style={{padding:"16px",textAlign:"center",color:"var(--green2)",fontSize:12}}>✓ No pending forms</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Opportunities by Type</div></div>
          <div className="card-body">
            {(()=>{
              const bp = topOpportunities.reduce((acc,o)=>{ const p=o.primary_pipeline||"general"; acc[p]=(acc[p]||0)+1; return acc; },{});
              const total = Math.max(topOpportunities.length,1);
              const segs = [
                {v:bp["opra"]||0,label:"OPRA",color:"#4299e1"},
                {v:bp["conversions"]||0,label:"Conversions",color:"#f0b429"},
                {v:bp["life"]||0,label:"Life",color:"#38a169"},
                {v:bp["retirement"]||0,label:"Retirement",color:"#553c9a"},
                {v:bp["business"]||0,label:"Business",color:"#7b2d8b"},
              ].filter(s=>s.v>0);
              return segs.length ? <Donut total={total} segs={segs}/> : <div style={{textAlign:"center",color:"var(--muted)",fontSize:12,padding:20}}>No scored data yet</div>;
            })()}
          </div>
        </div>
      </div>
      <div className="col">
        <div className="card">
          <div className="card-head"><div className="card-title">Pipeline Summary</div><button className="card-link" onClick={()=>onNav("opps")}>All →</button></div>
          <div className="card-body">
            {(()=>{
              const bp = topOpportunities.reduce((acc,o)=>{ const p=o.primary_pipeline||"general"; acc[p]=(acc[p]||0)+1; return acc; },{});
              const mx = Math.max(...Object.values(bp),1);
              const items=[
                {name:"OPRA Transfers",count:bp["opra"]||0,color:"#e53e3e"},
                {name:"Conversions",count:bp["conversions"]||0,color:"#f0b429"},
                {name:"Life Reviews",count:bp["life"]||0,color:"#38a169"},
                {name:"Retirement",count:bp["retirement"]||0,color:"#553c9a"},
                {name:"Business Owners",count:bp["business"]||0,color:"#7b2d8b"},
              ];
              return items.map((p,i)=>(
                <div className="pipeline-item" key={i}>
                  <div className="pipeline-rt"><div className="pipeline-name">{p.name}</div><div className="pipeline-count">{p.count}</div></div>
                  <div className="pbar"><div className="pbar-fill" style={{width:`${Math.round((p.count/mx)*100)}%`,background:p.color}}/></div>
                </div>
              ));
            })()}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">GDC Summary</div></div>
          <div className="card-body">
            <div className="rev-total">{"$"+(gdcPipe/1000).toFixed(0)+"k"}</div>
            <div className="rev-lbl">Pipeline Value · {gdcTier} ({gdc.tier_rate?Math.round(gdc.tier_rate*100)+"%":"—"} payout)</div>
            {[
              {cat:"Issued YTD",val:"$"+(gdcYTD/1000).toFixed(0)+"k"},
              {cat:"Pipeline GDC",val:"$"+(gdcPipe/1000).toFixed(0)+"k"},
              {cat:"FSA YTD",val:"$"+((gdc.fsa_ytd||0)/1000).toFixed(0)+"k"},
              {cat:"Pipeline FSA",val:"$"+((gdc.pipeline_fsa||0)/1000).toFixed(0)+"k"},
            ].map((r,i)=>(
              <div className="rev-row" key={i}><div className="rev-cat">{r.cat}</div><div className="rev-val">{r.val}</div></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </>);
}

// ─────────────────────────────────────────────────────────
// CONTACT UPLOAD — CSV → GoHighLevel bulk import
// Validates, de-dupes, maps fields, syncs into the GHL location, tags/stages,
// and logs every batch. Talks to POST/GET /api/ghl/contacts/upload.
// ─────────────────────────────────────────────────────────
// Stage names mirror src/lib/ghl.ts so the operator picks a real stage.
const UPLOAD_PIPELINES = [
  { key: "", label: "— No opportunity (contacts only) —", stages: [] },
  { key: "prospect_client", label: "Prospect / Client", stages: [
    "New Opportunity","Contacted","Appointment Scheduled","Appointment Completed","Fact-Finder Completed",
    "Recommendation Presented","Application Submitted","Issued","Annual Review Scheduled","Referral Requested"] },
  { key: "agency_owner", label: "Agency Owner", stages: [
    "Prospect Owner","Pilot (90-day)","Active Partner","Opportunity Handoff","Financial Assessment",
    "Quick Wins","Strategic Partner","Dormant"] },
  { key: "term_conversions", label: "Term Conversions", stages: [
    "Conversion Eligible Identified","Window Notice Sent","Review Scheduled","Conversion Illustrated",
    "Application Submitted","Converted (Issued)"] },
];

// Minimal header sniff for the pre-upload preview only (the server does the
// authoritative parse). Reads the first CSV line, honoring basic quoting.
function sniffHeaders(text) {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/)[0] || "";
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (q) { if (ch === '"' && firstLine[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

function ContactUploadPage({toast}) {
  const [file, setFile]         = useState(null);
  const [headers, setHeaders]   = useState([]);
  const [tags, setTags]         = useState("");
  const [source, setSource]     = useState("csv_upload");
  const [agencyOwner, setAgencyOwner] = useState("");
  const [pipeline, setPipeline] = useState("");
  const [stage, setStage]       = useState(1);
  const [busy, setBusy]         = useState(false);
  const [result, setResult]     = useState(null);
  const [drag, setDrag]         = useState(false);
  const [history, setHistory]   = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const inputRef = useRef(null);

  const loadHistory = () => {
    setHistLoading(true);
    fetch("/api/ghl/contacts/upload?limit=15")
      .then(r => r.ok ? r.json() : { batches: [] })
      .then(d => setHistory(d.batches || []))
      .catch(() => setHistory([]))
      .finally(() => setHistLoading(false));
  };
  useEffect(loadHistory, []);

  const acceptFile = (f) => {
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) { toast("Please choose a .csv or .xlsx file", "error"); return; }
    if (f.size > 5 * 1024 * 1024) { toast("File exceeds the 5MB limit", "error"); return; }
    setFile(f); setResult(null); setHeaders([]);
    // Client-side header preview only for CSV; Excel columns are recognized server-side.
    if (/\.csv$/i.test(f.name)) {
      const reader = new FileReader();
      reader.onload = e => { try { setHeaders(sniffHeaders(String(e.target.result || ""))); } catch { setHeaders([]); } };
      reader.readAsText(f.slice(0, 64 * 1024));
    }
  };

  const submit = async () => {
    if (!file) { toast("Choose a CSV file first", "error"); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (tags.trim()) fd.append("tags", tags.trim());
      if (source.trim()) fd.append("source", source.trim());
      if (agencyOwner.trim()) fd.append("agency_owner", agencyOwner.trim());
      if (pipeline) { fd.append("pipeline", pipeline); fd.append("stage", String(stage)); }
      const res = await fetch("/api/ghl/contacts/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || `Upload failed (HTTP ${res.status})`, "error");
        setResult({ error: data.error || `HTTP ${res.status}`, detail: data });
      } else {
        setResult(data);
        const c = data.counts || {};
        toast(`Imported ${c.success||0} · ${c.duplicate||0} dupes · ${c.invalid||0} invalid · ${c.failed||0} failed`,
          (c.failed||c.invalid) ? "info" : "success");
        loadHistory();
      }
    } catch (e) {
      toast("Network error during upload", "error");
      setResult({ error: String(e && e.message || e) });
    } finally { setBusy(false); }
  };

  const downloadAttention = () => {
    if (!result || !result.rows || !result.rows.length) return;
    const cols = ["row_number","status","first_name","last_name","email","phone","attempts","error_message"];
    const esc = v => { const s = String(v==null?"":v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    const csv = [cols.join(","), ...result.rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "upload-attention-rows.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const stages = (UPLOAD_PIPELINES.find(p => p.key === pipeline) || {}).stages || [];
  const counts = (result && result.counts) || {};
  const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:16, boxShadow:"var(--shadow)" };
  const kpi = (label, val, color) => (
    <div style={{...card, textAlign:"center", padding:14}}>
      <div style={{fontSize:26, fontWeight:700, color}}>{val}</div>
      <div style={{fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:".04em", marginTop:2}}>{label}</div>
    </div>
  );
  const METHOD_STYLE = {
    header:  { bg:"#ebf8ff", fg:"#2b6cb0", label:"header" },
    ai:      { bg:"#f0e9ff", fg:"#6b46c1", label:"AI" },
    content: { bg:"#e6fffa", fg:"#2c7a7b", label:"values" },
  };
  const renderColumns = (map, method) => {
    const entries = Object.entries(map || {});
    if (!entries.length) return null;
    return (
      <div style={{border:"1px solid var(--border)", borderRadius:6, overflow:"hidden", marginBottom:10}}>
        {entries.map(([header, field], i) => {
          const m = METHOD_STYLE[(method||{})[header]] || METHOD_STYLE.content;
          return (
            <div key={i} style={{display:"grid", gridTemplateColumns:"1fr auto auto", gap:8, alignItems:"center",
              padding:"5px 8px", borderBottom:"1px solid var(--border)", fontSize:10}}>
              <span style={{color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}} title={header}>{header}</span>
              <span style={{fontWeight:600, color:"var(--navy)", fontFamily:"DM Mono,monospace"}}>→ {field}</span>
              <span style={{fontSize:8, padding:"1px 6px", borderRadius:20, background:m.bg, color:m.fg, fontWeight:600}}>{m.label}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div style={{display:"grid", gridTemplateColumns:"minmax(0,1.4fr) minmax(0,1fr)", gap:16, alignItems:"start"}}>
        {/* Upload card */}
        <div style={card}>
          <div style={{fontSize:15, fontWeight:700, color:"var(--navy)", marginBottom:4}}>Upload Contacts to GoHighLevel</div>
          <div style={{fontSize:11, color:"var(--muted)", marginBottom:14, lineHeight:1.5}}>
            Import a CSV or Excel (.xlsx) file of contacts. The system reads the document and recognizes which
            column holds the name, email, phone, and more — even when the headers are unusual or missing — then
            validates, de-duplicates, and upserts each contact into your GHL location. No duplicates are ever
            created. Add tags, a source, and optionally drop everyone onto a pipeline stage.
          </div>

          <div
            onDragOver={e=>{e.preventDefault(); setDrag(true);}}
            onDragLeave={()=>setDrag(false)}
            onDrop={e=>{e.preventDefault(); setDrag(false); acceptFile(e.dataTransfer.files?.[0]);}}
            onClick={()=>inputRef.current&&inputRef.current.click()}
            style={{border:`2px dashed ${drag?"#4299e1":"var(--border)"}`, borderRadius:9, padding:"22px 16px",
              textAlign:"center", cursor:"pointer", background: drag?"#f0f7ff":"var(--bg)", transition:"all .15s"}}>
            <div style={{fontSize:26, marginBottom:6}}>📥</div>
            <div style={{fontSize:12, fontWeight:600, color:"var(--navy)"}}>
              {file ? file.name : "Drop a CSV or Excel file here or click to browse"}
            </div>
            <div style={{fontSize:10, color:"var(--muted)", marginTop:3}}>
              {file
                ? `${(file.size/1024).toFixed(1)} KB${headers.length?` · ${headers.length} columns`:" · columns recognized on upload"}`
                : "CSV or .xlsx · max 5MB · up to 1,000 rows"}
            </div>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{display:"none"}}
              onChange={e=>acceptFile(e.target.files?.[0])}/>
          </div>

          {headers.length > 0 && (
            <div style={{marginTop:10, display:"flex", flexWrap:"wrap", gap:5}}>
              {headers.map((h,i)=>(
                <span key={i} style={{fontSize:9, fontFamily:"DM Mono,monospace", background:"var(--bg2)",
                  border:"1px solid var(--border)", borderRadius:4, padding:"2px 6px", color:"var(--muted)"}}>{h}</span>
              ))}
            </div>
          )}

          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:14}}>
            <label style={{fontSize:11}}>
              <div style={{fontWeight:600, marginBottom:4, color:"var(--navy)"}}>Tags (comma-separated)</div>
              <input value={tags} onChange={e=>setTags(e.target.value)} placeholder="apex-import, warm-lead"
                style={{width:"100%", padding:"7px 9px", border:"1px solid var(--border)", borderRadius:6, fontSize:11, fontFamily:"DM Sans,sans-serif"}}/>
            </label>
            <label style={{fontSize:11}}>
              <div style={{fontWeight:600, marginBottom:4, color:"var(--navy)"}}>Source</div>
              <input value={source} onChange={e=>setSource(e.target.value)} placeholder="csv_upload"
                style={{width:"100%", padding:"7px 9px", border:"1px solid var(--border)", borderRadius:6, fontSize:11, fontFamily:"DM Sans,sans-serif"}}/>
            </label>
            <label style={{fontSize:11, gridColumn:"1 / -1"}}>
              <div style={{fontWeight:600, marginBottom:4, color:"var(--navy)"}}>Agency Owner (optional)</div>
              <input value={agencyOwner} onChange={e=>setAgencyOwner(e.target.value)} placeholder="Referring agency owner — applied when a row has no Agency Owner column"
                style={{width:"100%", padding:"7px 9px", border:"1px solid var(--border)", borderRadius:6, fontSize:11, fontFamily:"DM Sans,sans-serif"}}/>
            </label>
            <label style={{fontSize:11}}>
              <div style={{fontWeight:600, marginBottom:4, color:"var(--navy)"}}>Pipeline (optional)</div>
              <select value={pipeline} onChange={e=>{setPipeline(e.target.value); setStage(1);}}
                style={{width:"100%", padding:"7px 9px", border:"1px solid var(--border)", borderRadius:6, fontSize:11, fontFamily:"DM Sans,sans-serif", background:"#fff"}}>
                {UPLOAD_PIPELINES.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label style={{fontSize:11, opacity: stages.length?1:.5}}>
              <div style={{fontWeight:600, marginBottom:4, color:"var(--navy)"}}>Stage</div>
              <select value={stage} onChange={e=>setStage(Number(e.target.value))} disabled={!stages.length}
                style={{width:"100%", padding:"7px 9px", border:"1px solid var(--border)", borderRadius:6, fontSize:11, fontFamily:"DM Sans,sans-serif", background:"#fff"}}>
                {stages.length ? stages.map((s,i)=><option key={i} value={i+1}>{i+1}. {s}</option>) : <option>—</option>}
              </select>
            </label>
          </div>

          <button className="btn-primary" disabled={busy||!file} onClick={submit}
            style={{width:"100%", marginTop:14, padding:"10px", fontSize:12, opacity:(busy||!file)?.6:1, cursor:(busy||!file)?"not-allowed":"pointer"}}>
            {busy ? "Uploading & syncing to GHL…" : "Import & Sync to GoHighLevel"}
          </button>
          <div style={{fontSize:9, color:"var(--muted)", marginTop:8, lineHeight:1.5}}>
            Columns are recognized three ways: exact header match → AI reading the headers &amp; sample rows →
            value patterns (an email-shaped column becomes <b>email</b> even if it&apos;s labelled &quot;Col C&quot;).
            Recognized: <b>name / first / last</b>, <b>email</b>, <b>phone</b>, <b>tags</b>, <b>source</b>,
            <b> agency owner</b>, city/state/zip, plus product interest &amp; life stage. A name and either email
            or phone are required.
          </div>
        </div>

        {/* Result panel */}
        <div style={{...card, minHeight:180}}>
          <div style={{fontSize:13, fontWeight:700, color:"var(--navy)", marginBottom:12}}>Import Result</div>
          {!result && <div style={{fontSize:11, color:"var(--muted)"}}>Run an import to see per-row results here.</div>}
          {result && result.error && (
            <div>
              <div style={{fontSize:11, color:"var(--red)", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:7, padding:12}}>
                {result.error}
                {result.detail && result.detail.headers &&
                  <div style={{marginTop:8, color:"var(--muted)", fontSize:10}}>Columns found: {result.detail.headers.join(", ")}</div>}
              </div>
              {result.detail && result.detail.detected_columns && Object.keys(result.detail.detected_columns).length > 0 && (
                <div style={{marginTop:10}}>
                  <div style={{fontSize:11, fontWeight:600, marginBottom:6}}>What we did recognize</div>
                  {renderColumns(result.detail.detected_columns, result.detail.detection_method)}
                </div>
              )}
            </div>
          )}
          {result && !result.error && (
            <>
              <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginBottom:12}}>
                {kpi("Imported", counts.success||0, "var(--green2)")}
                {kpi("Duplicates", counts.duplicate||0, "#b7791f")}
                {kpi("Invalid", counts.invalid||0, "var(--muted)")}
                {kpi("Failed", counts.failed||0, "var(--red)")}
              </div>
              <div style={{fontSize:10, color:"var(--muted)", marginBottom:8}}>
                {result.total} rows · location {result.location_id}
                {result.pipeline ? ` · ${result.pipeline} stage ${result.stage}` : ""}
                {result.ai_used ? " · AI column recognition" : result.ai_available ? "" : " · header/value recognition"}
              </div>
              {result.detected_columns && Object.keys(result.detected_columns).length > 0 && (
                <>
                  <div style={{fontSize:11, fontWeight:600, marginBottom:6}}>Recognized columns</div>
                  {renderColumns(result.detected_columns, result.detection_method)}
                </>
              )}
              {result.rows && result.rows.length > 0 && (
                <>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
                    <div style={{fontSize:11, fontWeight:600}}>Rows needing attention ({result.rows.length})</div>
                    <button className="btn-secondary" style={{fontSize:9, padding:"3px 8px"}} onClick={downloadAttention}>⬇ CSV</button>
                  </div>
                  <div style={{maxHeight:220, overflowY:"auto", border:"1px solid var(--border)", borderRadius:6}}>
                    {result.rows.map((r,i)=>(
                      <div key={i} style={{display:"grid", gridTemplateColumns:"34px 62px 1fr", gap:6, padding:"6px 8px",
                        borderBottom:"1px solid var(--border)", fontSize:10, alignItems:"center"}}>
                        <span style={{color:"var(--muted)", fontFamily:"DM Mono,monospace"}}>#{r.row_number}</span>
                        <span style={{fontWeight:600, color: r.status==="failed"?"var(--red)": r.status==="duplicate"?"#b7791f":"var(--muted)"}}>{r.status}</span>
                        <span style={{color:"var(--muted)"}}>{r.error_message || `${r.first_name||""} ${r.last_name||""}`.trim()}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {result.rows && result.rows.length === 0 &&
                <div style={{fontSize:11, color:"var(--green2)", fontWeight:600}}>✓ Every row imported cleanly.</div>}
            </>
          )}
        </div>
      </div>

      {/* Upload history */}
      <div style={{...card, marginTop:16}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
          <div style={{fontSize:13, fontWeight:700, color:"var(--navy)"}}>Upload History</div>
          <button className="btn-secondary" style={{fontSize:10, padding:"4px 10px"}} onClick={loadHistory}>↻ Refresh</button>
        </div>
        {histLoading && <div style={{fontSize:11, color:"var(--muted)"}}>Loading…</div>}
        {!histLoading && history.length === 0 && <div style={{fontSize:11, color:"var(--muted)"}}>No imports yet.</div>}
        {!histLoading && history.length > 0 && (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:11}}>
              <thead>
                <tr style={{textAlign:"left", color:"var(--muted)", fontSize:9, textTransform:"uppercase", letterSpacing:".04em"}}>
                  <th style={{padding:"6px 8px"}}>File</th><th style={{padding:"6px 8px"}}>When</th>
                  <th style={{padding:"6px 8px"}}>Total</th><th style={{padding:"6px 8px"}}>OK</th>
                  <th style={{padding:"6px 8px"}}>Dup</th><th style={{padding:"6px 8px"}}>Inv</th>
                  <th style={{padding:"6px 8px"}}>Fail</th><th style={{padding:"6px 8px"}}>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(b=>(
                  <tr key={b.batch_id} style={{borderTop:"1px solid var(--border)"}}>
                    <td style={{padding:"7px 8px", fontWeight:600}}>{b.filename||"—"}</td>
                    <td style={{padding:"7px 8px", color:"var(--muted)"}}>{b.created_at ? new Date(b.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "—"}</td>
                    <td style={{padding:"7px 8px"}}>{b.total_rows}</td>
                    <td style={{padding:"7px 8px", color:"var(--green2)", fontWeight:600}}>{b.success_count}</td>
                    <td style={{padding:"7px 8px", color:"#b7791f"}}>{b.duplicate_count}</td>
                    <td style={{padding:"7px 8px", color:"var(--muted)"}}>{b.invalid_count}</td>
                    <td style={{padding:"7px 8px", color: b.failed_count?"var(--red)":"var(--muted)", fontWeight:b.failed_count?600:400}}>{b.failed_count}</td>
                    <td style={{padding:"7px 8px"}}><span style={{fontSize:9, padding:"2px 7px", borderRadius:20, background: b.status==="complete"?"#dcfce7":"#fef9c3", color: b.status==="complete"?"#166534":"#854d0e"}}>{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// AGENCY OWNERS — Full relationship + referral management
// ─────────────────────────────────────────────────────────
function AgencyOwners({toast, onNav}) {
  const [tab, setTab]             = useState("overview");
  const [selected, setSelected]   = useState(null);
  const [detailTab, setDetailTab] = useState("referrals");
  const [addForm, setAddForm]     = useState({name:"",owner:"",phone:"",email:"",city:""});
  const [agencies, setAgencies]   = useState([]);
  const [referralsByAgency, setReferralsByAgency] = useState({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const fmtK = n => n >= 1000 ? "$"+(n/1000).toFixed(0)+"k" : "$"+n;
  const fmtD = n => "$"+Number(n||0).toLocaleString("en-US");
  const BASE = typeof window !== "undefined" ? window.location.origin : "https://fsos.vercel.app";

  // Load live agencies (source of truth) + raw referral list
  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      fetch("/api/agencies/list").then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }),
      fetch("/api/agencies/referral?limit=200").then(r=>r.ok?r.json():{referrals:[]}).catch(()=>({referrals:[]})),
    ]).then(([listData, refData]) => {
      const refs = refData.referrals || [];
      const byAgency = {};
      refs.forEach(r => {
        if(!byAgency[r.agency_id]) byAgency[r.agency_id] = [];
        byAgency[r.agency_id].push(r);
      });
      setReferralsByAgency(byAgency);

      // Build the agency list PURELY from the live API. Fields the API does not
      // provide are shown as 0 / "—" — never fabricated.
      const live = listData.agencies || [];
      setAgencies(live.map(a => {
        const days = a.days_since_referral ?? null;
        return {
          id: a.agency_id,
          name: a.name || "Agency",
          owner: a.owner || "—",
          city: a.city || "—",
          phone: a.phone || "—",
          email: a.email || "—",
          slug: a.slug || "",
          agencyZoom: null, apex: null,
          firstReferral: "—",
          lastReferral: a.last_referral ? new Date(a.last_referral).toISOString().split("T")[0] : "—",
          referrals: a.referral_count ?? 0,
          pendingReferrals: a.pending_referrals ?? 0,
          daysSinceReferral: days,
          lastActivity: days,
          needsAttention: !!a.needs_attention,
          ghlStage: a.ghl?.stage||null,
          ghlPos: a.ghl?.stage_position||null,
          ghlPipeline: a.ghl?.pipeline||null,
          inGhl: !!a.ghl?.in_ghl,
          // Metrics the API doesn't expose yet → honest 0 / "—".
          uploads: 0, contacts: 0, appts: 0, apps: 0, issued: 0, issuedGDC: 0, pendingOpp: 0,
          opra: 0, conv: 0, life: 0, retire: 0, biz: 0,
          notes: "",
          lastCall: "—", lastMeeting: "—", lastEmail: "—",
          uploadHistory: [],
        };
      }));
      setLoading(false);
    }).catch(e => { setError(e.message||"Failed to load"); setAgencies([]); setLoading(false); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Attach the live referral list to each agency (source of truth for referrals).
  const enrichedAgencies = agencies.map(ag => {
    const refs = referralsByAgency[ag.id] || [];
    return {
      ...ag,
      referralList: refs.slice(0,20).map(r => ({
        client: r.client_name || "Unknown",
        type: r.referral_type || "general",
        submitted: r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—",
        appt: null,
        status: r.status === "new" ? "Received" : (r.status ? r.status.charAt(0).toUpperCase()+r.status.slice(1) : "—"),
      })),
    };
  });

  const totalReferrals = enrichedAgencies.reduce((s,a)=>s+a.referrals,0);
  const totalOpps      = enrichedAgencies.reduce((s,a)=>s+a.pendingOpp,0);
  const totalGDC       = enrichedAgencies.reduce((s,a)=>s+a.issuedGDC,0);
  const attention      = enrichedAgencies.filter(a=>a.needsAttention);
  const maxGDC         = Math.max(...enrichedAgencies.map(a=>a.issuedGDC),1);

  // ── DETAIL VIEW ────────────────────────────────────────
  if (selected) {
    const ag = enrichedAgencies.find(a=>a.id===selected);
    if (!ag) { setSelected(null); return null; }
    const refLink = `${BASE}/${ag.slug}`;
    const upLink  = `${BASE}/upload/${ag.slug}`;
    const copy = (txt,lbl) => { navigator.clipboard?.writeText(txt); toast(`${lbl} copied!`,"success"); };

    const detailTabs = [
      {id:"referrals",  label:"Referrals"},
      {id:"uploads",    label:"Upload History"},
      {id:"opps",       label:"Opportunities"},
      {id:"comms",      label:"Communications"},
    ];

    return (
      <>
        {/* BREADCRUMB */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
          <button className="card-link" style={{fontSize:12,padding:0}} onClick={()=>setSelected(null)}>← Agency Owners</button>
          <span style={{color:"var(--dim)"}}>›</span>
          <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{ag.name}</span>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:14}}>

          {/* LEFT PANEL — Identity + links */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {/* Agency card */}
            <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:18,boxShadow:"var(--shadow)"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:12,borderBottom:"1px solid var(--border)"}}>
                <div style={{width:44,height:44,borderRadius:10,background:"linear-gradient(135deg,#2b6cb0,#1a4a8a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff",flexShrink:0}}>
                  {ag.name[0]}
                </div>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"var(--navy)"}}>{ag.name}</div>
                  <div style={{fontSize:10,color:"var(--muted)",marginTop:1}}>{ag.city}</div>
                </div>
              </div>
              {[["Owner",ag.owner],["Phone",ag.phone],["Email",ag.email],["AgencyZoom",ag.agencyZoom==null?"—":ag.agencyZoom?"Connected":"Not connected"],["APEX",ag.apex==null?"—":ag.apex?"Connected":"Not connected"],["First Referral",ag.firstReferral],["Last Referral",ag.lastReferral]].map(([l,v],i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border)",fontSize:11}}>
                  <span style={{color:"var(--muted)"}}>{l}</span>
                  <span style={{fontWeight:500,color:l==="AgencyZoom"||l==="APEX"?(v==="Connected"?"var(--green2)":"var(--red)"):"var(--text)",fontSize:l==="Phone"||l==="Email"?11:11}}>
                    {l==="Phone"?<a href={"tel:"+v.replace(/[^0-9]/g,"")} style={{color:"var(--blue)",textDecoration:"none"}}>{v}</a>:
                     l==="Email"?<a href={"mailto:"+v} style={{color:"var(--blue)",textDecoration:"none"}}>{v}</a>:v}
                  </span>
                </div>
              ))}
            </div>

            {/* Referral Link */}
            <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:16,boxShadow:"var(--shadow)"}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--navy)",marginBottom:6,display:"flex",alignItems:"center",gap:5}}>
                🔗 Referral Link
              </div>
              <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"7px 10px",fontFamily:"DM Mono,monospace",fontSize:9,color:"var(--muted)",marginBottom:6,wordBreak:"break-all"}}>{refLink}</div>
              <button className="btn-primary" style={{width:"100%",fontSize:11}} onClick={()=>copy(refLink,"Referral link")}>Copy Referral Link</button>
              <div style={{fontSize:9,color:"var(--muted)",marginTop:5}}>All submissions auto-tagged: Agency → {ag.name}</div>
            </div>

            {/* Upload Link */}
            <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:16,boxShadow:"var(--shadow)"}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--navy)",marginBottom:6,display:"flex",alignItems:"center",gap:5}}>
                📤 Upload Link
              </div>
              <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"7px 10px",fontFamily:"DM Mono,monospace",fontSize:9,color:"var(--muted)",marginBottom:6,wordBreak:"break-all"}}>{upLink}</div>
              <button className="btn-secondary" style={{width:"100%",fontSize:11}} onClick={()=>copy(upLink,"Upload link")}>Copy Upload Link</button>
              <div style={{fontSize:9,color:"var(--muted)",marginTop:5}}>No login required · Accepts OPRA exports, customer lists, AgencyZoom exports</div>
            </div>

            {/* Performance KPIs */}
            <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:16,boxShadow:"var(--shadow)"}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--navy)",marginBottom:10}}>Agency Performance</div>
              {[
                ["Referrals Submitted",ag.referrals,"#2b6cb0"],
                ["Customer Uploads",ag.uploads,"#2b6cb0"],
                ["Contacts Uploaded",ag.contacts.toLocaleString(),"var(--text)"],
                ["Appointments Generated",ag.appts,"var(--orange)"],
                ["Applications Submitted",ag.apps,"var(--orange)"],
                ["Issued Cases",ag.issued,"var(--green2)"],
                ["Estimated GDC",fmtD(ag.issuedGDC),"var(--green2)"],
              ].map(([l,v,c],i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                  <span style={{fontSize:11,color:"var(--muted)"}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:700,color:c}}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT PANEL — Tabs */}
          <div>
            {/* Opportunity summary strip */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
              {[{l:"Conversions",v:ag.conv,c:"#f0b429"},{l:"Life Reviews",v:ag.life,c:"#2b6cb0"},{l:"Retirement",v:ag.retire,c:"#553c9a"},{l:"Business Owners",v:ag.biz,c:"#7b2d8b"},{l:"OPRA",v:ag.opra,c:"#e53e3e"}].map((o,i)=>(
                <div key={i} style={{background:"var(--card)",border:`2px solid ${o.c}22`,borderRadius:9,padding:"10px 12px",textAlign:"center",cursor:"pointer",boxShadow:"var(--shadow)"}}
                  onClick={()=>toast(`Opening ${o.l} for ${ag.name}`,"info")}>
                  <div style={{fontSize:22,fontWeight:700,color:o.c,lineHeight:1}}>{o.v}</div>
                  <div style={{fontSize:9,color:"var(--muted)",marginTop:3}}>{o.l}</div>
                </div>
              ))}
            </div>

            {/* Detail tabs */}
            <div className="tab-bar" style={{marginBottom:12}}>
              {detailTabs.map(t=><button key={t.id} className={`tab-btn ${detailTab===t.id?"active":""}`} onClick={()=>setDetailTab(t.id)}>{t.label}</button>)}
            </div>

            {/* REFERRALS TAB */}
            {detailTab==="referrals" && (
              <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                  <div style={{fontSize:13,fontWeight:600}}>{ag.referralList.length} Referrals</div>
                  <button className="btn-primary" style={{fontSize:10,padding:"4px 12px"}} onClick={()=>toast("Add referral modal","info")}>+ Add Referral</button>
                </div>
                {ag.referralList.length===0
                  ? <div style={{padding:32,textAlign:"center",color:"var(--muted)",fontSize:12}}>No referrals yet · Share the referral link above to get started</div>
                  : ag.referralList.map((r,i)=>(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:12,padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{r.client}</div>
                      <div style={{fontSize:10,color:"var(--muted)"}}>{r.type} · Submitted {r.submitted}{r.appt?` · Appt ${r.appt}`:""}</div>
                    </div>
                    <span className={`sp ${r.status.includes("Issued")||r.status.includes("Complete")?"sp-confirmed":r.status.includes("Submitted")?"sp-submitted":"sp-pending"}`} style={{alignSelf:"center"}}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* UPLOADS TAB */}
            {detailTab==="uploads" && (
              <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:"1px solid var(--border)"}}>
                  <div style={{fontSize:13,fontWeight:600}}>Upload History</div>
                  <button className="btn-primary" style={{fontSize:10,padding:"4px 12px"}} onClick={()=>onNav?onNav("upload"):toast("Open Contact Upload from the sidebar","info")}>+ Upload Contacts to GHL</button>
                </div>
                {ag.uploadHistory.map((u,i)=>(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:12,padding:"14px 16px",borderBottom:"1px solid var(--border)"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{u.type}</div>
                      <div style={{fontSize:11,color:"var(--muted)"}}>{u.date} · {u.records.toLocaleString()} records</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:18,fontWeight:700,color:"var(--green2)"}}>{u.opps}</div>
                      <div style={{fontSize:9,color:"var(--muted)"}}>Opportunities</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* OPPORTUNITIES TAB */}
            {detailTab==="opps" && (
              <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:18,boxShadow:"var(--shadow)"}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>Generated Opportunities</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[{l:"Life Reviews",v:ag.life,c:"#2b6cb0"},{l:"Conversions",v:ag.conv,c:"#f0b429"},{l:"Retirement Reviews",v:ag.retire,c:"#553c9a"},{l:"Business Owners",v:ag.biz,c:"#7b2d8b"},{l:"OPRA Transfers",v:ag.opra,c:"#e53e3e"}].map((o,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"var(--bg)",borderRadius:7,border:"1px solid var(--border)",cursor:"pointer",transition:"all .15s"}}
                      onClick={()=>toast(`Viewing ${o.l} for ${ag.name}`,"info")}
                      onMouseOver={e=>{e.currentTarget.style.borderColor="#bee3f8";}}
                      onMouseOut={e=>{e.currentTarget.style.borderColor="var(--border)";}}>
                      <div style={{fontWeight:500,fontSize:13}}>{o.l}</div>
                      <div style={{fontSize:22,fontWeight:700,color:o.c}}>{o.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* COMMUNICATIONS TAB */}
            {detailTab==="comms" && (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:18,boxShadow:"var(--shadow)"}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>Contact History</div>
                  {[["Last Call",ag.lastCall,"📞"],["Last Meeting",ag.lastMeeting,"📅"],["Last Email",ag.lastEmail,"📧"]].map(([l,v,icon],i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                      <span style={{fontSize:12,color:"var(--muted)"}}>{icon} {l}</span>
                      <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:500}}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:18,boxShadow:"var(--shadow)"}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Notes</div>
                  <div style={{fontSize:12,color:"var(--text)",lineHeight:1.7,marginBottom:12}}>{ag.notes}</div>
                  <textarea defaultValue={ag.notes} rows={3}
                    style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"8px 10px",fontFamily:"DM Sans,sans-serif",fontSize:12,color:"var(--text)",resize:"vertical",outline:"none"}}/>
                  <button className="btn-primary" style={{marginTop:8,fontSize:11,padding:"5px 14px"}} onClick={()=>toast("Notes saved","success")}>Save Notes</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── OVERVIEW TAB ────────────────────────────────────────
  if (tab==="overview") return (
    <>
      {/* HEADER STRIP */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div>
          <div className="page-title" style={{marginBottom:2}}>Agency Owners</div>
          <div style={{fontSize:12,color:"var(--muted)"}}>Your distribution channel · {enrichedAgencies.length} agencies · Last sync: today</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-secondary" style={{fontSize:11}} onClick={refresh}>↻ Refresh</button>
          <button className="btn-secondary" style={{fontSize:11}} onClick={()=>setTab("leaderboard")}>🏆 Leaderboard</button>
          <button className="btn-primary" style={{fontSize:11}} onClick={()=>setTab("add")}>+ Add Agency</button>
        </div>
      </div>

      {error && <div className="error-banner"><span>⚠ Couldn't load agencies ({error}).</span><button onClick={refresh}>Retry</button></div>}
      {loading && <div className="loading-state"><div className="loading-spinner"/><div>Loading agencies…</div></div>}
      {!loading && !error && enrichedAgencies.length===0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🏢</div>
          <div className="empty-state-title">No agencies yet</div>
          <div className="empty-state-sub">Add an agency owner to generate their referral and upload links.</div>
        </div>
      )}

      {/* TOP METRICS */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
        {[
          {l:"Total Agencies",v:enrichedAgencies.length,c:"var(--text)",icon:"🏢"},
          {l:"Total Referrals",v:totalReferrals,c:"#2b6cb0",icon:"🔗"},
          {l:"Pending Opportunities",v:totalOpps,c:"var(--orange)",icon:"🎯"},
          {l:"Total Issued GDC",v:fmtK(totalGDC),c:"var(--green2)",icon:"💰"},
          {l:"Need Attention",v:attention.length,c:attention.length>0?"var(--red)":"var(--green2)",icon:"⚠️"},
        ].map((s,i)=>(
          <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"14px 16px",boxShadow:"var(--shadow)",display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:10,color:"var(--muted)",marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:24,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
            </div>
            <span style={{fontSize:18}}>{s.icon}</span>
          </div>
        ))}
      </div>

      {/* NEEDS ATTENTION */}
      {attention.length>0 && (
        <div style={{background:"var(--red-bg)",border:"1px solid var(--red-border)",borderRadius:10,padding:"14px 18px",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--red)",marginBottom:10}}>⚠ Needs Attention</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {attention.map((a,i)=>(
              <div key={i} style={{background:"var(--card)",border:"1px solid var(--red-border)",borderRadius:7,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}
                onClick={()=>setSelected(a.id)}>
                <div>
                  <div style={{fontWeight:600,fontSize:12,color:"var(--navy)"}}>{a.name}</div>
                  <div style={{fontSize:10,color:"var(--red)",marginTop:2}}>
                    {a.daysSinceReferral>30 ? `No referrals in ${a.daysSinceReferral} days` : "3 opportunities unworked"}
                  </div>
                </div>
                <span style={{fontSize:11,color:"var(--blue)",marginLeft:8}}>Call →</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AGENCY CARDS */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
        {enrichedAgencies.map((a,i)=>(
          <div key={i} style={{background:"var(--card)",border:`1px solid ${a.needsAttention?"var(--red-border)":"var(--border)"}`,borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)",transition:"box-shadow .15s"}}
            onMouseOver={e=>e.currentTarget.style.boxShadow="var(--shadow2)"}
            onMouseOut={e=>e.currentTarget.style.boxShadow="var(--shadow)"}>

            {/* Card header */}
            <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <div style={{width:38,height:38,borderRadius:9,background:"linear-gradient(135deg,#2b6cb0,#1a4a8a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"#fff",flexShrink:0}}>{a.name[0]}</div>
                <div>
                  <div style={{fontWeight:600,fontSize:13,color:"var(--navy)"}}>{a.name}</div>
                  <div style={{fontSize:10,color:"var(--muted)",marginTop:1}}>{a.city} · {a.owner}</div>
                  {(a.ghlStage||a.inGhl) && <div style={{marginTop:4}}><GhlBadge stage={a.ghlStage} pos={a.ghlPos} pipeline={a.ghlPipeline} inGhl={a.inGhl}/></div>}
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:9,color:"var(--muted)",fontFamily:"DM Mono,monospace",marginBottom:2}}>
                  {a.needsAttention ? <span style={{color:"var(--red)",fontWeight:700}}>⚠ NEEDS ATTENTION · {a.daysSinceReferral}d</span> : `Active ${a.daysSinceReferral!=null?a.daysSinceReferral:a.lastActivity}d ago`}
                </div>
                {a.pendingReferrals>0 && <div style={{fontSize:9,color:"var(--orange)",fontFamily:"DM Mono,monospace",marginBottom:2}}>{a.pendingReferrals} pending referral{a.pendingReferrals!==1?"s":""}</div>}
                <div style={{fontSize:16,fontWeight:700,color:"var(--green2)"}}>{fmtK(a.issuedGDC)}</div>
              </div>
            </div>

            {/* GDC bar */}
            <div style={{height:3,background:"var(--bg2)"}}>
              <div style={{height:"100%",width:`${(a.issuedGDC/maxGDC)*100}%`,background:"var(--green2)",transition:"width .6s"}}/>
            </div>

            {/* Stats grid */}
            <div style={{padding:"12px 16px"}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:10}}>
                {[{l:"Referrals",v:a.referrals,c:"#2b6cb0"},{l:"Appointments",v:a.appts,c:"var(--orange)"},{l:"Applications",v:a.apps,c:"var(--orange)"},{l:"Issued",v:a.issued,c:"var(--green2)"}].map((k,j)=>(
                  <div key={j} style={{textAlign:"center",background:"var(--bg)",borderRadius:5,padding:"7px 4px"}}>
                    <div style={{fontSize:16,fontWeight:700,color:k.c,lineHeight:1}}>{k.v}</div>
                    <div style={{fontSize:8,color:"var(--muted)",marginTop:2}}>{k.l}</div>
                  </div>
                ))}
              </div>

              {/* Opp tags */}
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
                {[{l:"Conv",v:a.conv,c:"#f0b429"},{l:"Life",v:a.life,c:"#2b6cb0"},{l:"Retire",v:a.retire,c:"#553c9a"},{l:"Biz",v:a.biz,c:"#7b2d8b"},{l:"OPRA",v:a.opra,c:"#e53e3e"}].map((o,k)=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:3,background:"var(--bg2)",borderRadius:4,padding:"2px 7px",fontSize:10}}>
                    <span style={{fontWeight:700,color:o.c}}>{o.v}</span>
                    <span style={{color:"var(--muted)"}}>{o.l}</span>
                  </div>
                ))}
              </div>

              <div style={{display:"flex",gap:6}}>
                <button className="btn-primary" style={{flex:1,fontSize:11,padding:8}} onClick={()=>setSelected(a.id)}>
                  Open {a.name} →
                </button>
                <button title="Push this owner into the GHL Agency Owner pipeline"
                  style={{fontSize:11,padding:"8px 10px",borderRadius:5,border:"1px solid #d6bcfa",background:"#f0e9ff",color:"#6b46c1",cursor:"pointer",whiteSpace:"nowrap"}}
                  onClick={async ()=>{
                    toast(`Syncing ${a.owner||a.name} to GHL…`,"info");
                    const r=await syncToGhl({agency_id:a.id, pipeline:"agency_owner", stage:a.inGhl?(a.ghlPos||1):1});
                    if(r.ok){toast(`${a.name} synced to GHL`,"success");refresh();}
                    else toast(r.data?.error||`GHL sync failed (${r.status})`,"error");
                  }}>◆ {a.inGhl?"Re-sync":"Sync GHL"}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  // ── LEADERBOARD TAB ─────────────────────────────────────
  if (tab==="leaderboard") {
    const sorted = [...enrichedAgencies].sort((a,b)=>b.issuedGDC-a.issuedGDC);
    return (
      <>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <button className="card-link" style={{fontSize:12}} onClick={()=>setTab("overview")}>← Overview</button>
          <div className="page-title" style={{marginBottom:0}}>Agency Leaderboard</div>
        </div>
        {sorted.map((a,i)=>(
          <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"16px 20px",marginBottom:8,boxShadow:"var(--shadow)",display:"grid",gridTemplateColumns:"36px 1fr auto",gap:14,alignItems:"center",cursor:"pointer"}}
            onClick={()=>setSelected(a.id)}
            onMouseOver={e=>e.currentTarget.style.boxShadow="var(--shadow2)"}
            onMouseOut={e=>e.currentTarget.style.boxShadow="var(--shadow)"}>
            <div style={{fontSize:20,fontWeight:800,color:i===0?"var(--gold)":i===1?"var(--muted)":i===2?"#c77c3a":"var(--dim)",textAlign:"center"}}>
              {i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}
            </div>
            <div>
              <div style={{fontWeight:600,fontSize:13,color:"var(--navy)"}}>{a.name}</div>
              <div style={{fontSize:10,color:"var(--muted)",marginTop:2,fontFamily:"DM Mono,monospace"}}>
                {a.issued} issued · {a.referrals} referrals · {a.appts} appts
              </div>
              <div style={{height:4,background:"var(--bg2)",borderRadius:2,marginTop:6,width:"100%",overflow:"hidden"}}>
                <div style={{height:"100%",width:`${(a.issuedGDC/maxGDC)*100}%`,background:`${i===0?"#f0b429":i===1?"#a0a8b8":"#c77c3a"}`,borderRadius:2}}/>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:22,fontWeight:700,color:"var(--green2)"}}>{fmtK(a.issuedGDC)}</div>
              <div style={{fontSize:9,color:"var(--muted)",fontFamily:"DM Mono,monospace"}}>GDC Pipeline</div>
            </div>
          </div>
        ))}
      </>
    );
  }

  // ── ADD AGENCY TAB ──────────────────────────────────────
  return (
    <>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="card-link" style={{fontSize:12}} onClick={()=>setTab("overview")}>← Overview</button>
        <div className="page-title" style={{marginBottom:0}}>Add Agency Owner</div>
      </div>
      <div style={{maxWidth:520,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:24,boxShadow:"var(--shadow)"}}>
        {[["Agency Name","name","text"],["Owner Name","owner","text"],["Phone","phone","tel"],["Email","email","email"],["City, State","city","text"]].map(([l,k,t])=>(
          <div key={k} style={{marginBottom:14}}>
            <label style={{display:"block",fontSize:10,fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".07em",color:"var(--muted)",marginBottom:4}}>{l}</label>
            <input type={t} value={addForm[k]} onChange={e=>setAddForm(f=>({...f,[k]:e.target.value}))}
              style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"8px 10px",fontFamily:"DM Sans,sans-serif",fontSize:12,color:"var(--text)",outline:"none"}}/>
          </div>
        ))}
        {addForm.name && (
          <div style={{background:"var(--blue-bg)",border:"1px solid var(--blue-border)",borderRadius:7,padding:"12px 14px",marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:600,color:"var(--blue)",marginBottom:6}}>Links that will be auto-generated:</div>
            <div style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--text)",marginBottom:3}}>
              🔗 {BASE}/{addForm.name.toLowerCase().replace(/\s+/g,"-")}
            </div>
            <div style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--text)"}}>
              📤 {BASE}/upload/{addForm.name.toLowerCase().replace(/\s+/g,"-")}
            </div>
          </div>
        )}
        <button className="btn-primary" style={{width:"100%",padding:10,fontSize:13}} onClick={()=>{
          if(!addForm.name||!addForm.owner){toast("Agency name and owner required","error");return;}
          toast(`✓ ${addForm.name} added · Referral and upload links generated`,"success");
          setAddForm({name:"",owner:"",phone:"",email:"",city:""});
          setTab("overview");
        }}>
          Create Agency + Generate Links →
        </button>
      </div>
    </>
  );
}

function Calendar(){
  const [appts, setAppts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    fetch("/api/dashboard?scope=calendar")
      .then(r => { if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(d => { setAppts(d.appointments || []); setLoading(false); })
      .catch(e => { setError(e.message||"Failed to load"); setLoading(false); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const fmtWhen = s => s ? new Date(s).toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "—";
  const colorFor = ch => ({sms:"#dd6b20",email:"#4299e1",phone:"#38a169"}[(ch||"").toLowerCase()] || "#553c9a");

  return(<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <div className="page-title" style={{marginBottom:0}}>Calendar</div>
      <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={refresh}>↻ Refresh</button>
    </div>
    <div style={{marginBottom:10,fontSize:12,color:"var(--muted)"}}>
      Appointments booked through Calendly appear here automatically.
    </div>
    {error && <div className="error-banner"><span>⚠ Couldn't load appointments ({error}).</span><button onClick={refresh}>Retry</button></div>}
    {loading && <div className="loading-state"><div className="loading-spinner"/><div>Loading appointments…</div></div>}
    {!loading && !error && appts.length===0 && (
      <div className="empty-state">
        <div className="empty-state-icon">📅</div>
        <div className="empty-state-title">No appointments booked yet</div>
        <div className="empty-state-sub">Bookings arrive automatically via Calendly.</div>
      </div>
    )}
    {!loading && appts.length>0 && (
      <div className="cal-card">
        <div className="cal-hdr">UPCOMING</div>
        {appts.map((a,i)=>(
          <div className="cal-item" key={a.activity_id||i}>
            <div className="cal-time" style={{width:120,fontSize:10}}>{fmtWhen(a.booked_at)}</div>
            <div className="cal-dot2" style={{background:colorFor(a.channel)}}/>
            <div className="cal-info">
              <div className="cal-name">{a.client||"Unknown"}</div>
              <div className="cal-type">{a.subject||"Appointment"}{a.notes?` · ${a.notes}`:""}</div>
              <div style={{fontSize:9,color:"var(--dim)",fontFamily:"DM Mono,monospace",marginTop:2}}>{[a.phone,a.email].filter(Boolean).join(" · ")}</div>
            </div>
            {a.channel && <span className="sp sp-submitted">{a.channel}</span>}
          </div>
        ))}
      </div>
    )}
  </>);
}

// ════════════════════════════════════════
// FORMS SYSTEM — Data + Components
// ════════════════════════════════════════

// ── FORM DEFINITIONS ──────────────────────────────────────
const FORMS = [
  {
    id:"customer-questionnaire",
    title:"Customer Questionnaire",
    formNum:"318507",
    icon:"📋",
    color:"#2b6cb0", bg:"#ebf8ff",
    desc:"Personal information and areas of concern intake. Covers 401(k), IRA, life insurance status. First-contact discovery form.",
    tags:["Pre-meeting","Life","Retirement","401k"],
    fields:[
      {id:"first_name",label:"First Name",type:"text",required:true},
      {id:"last_name",label:"Last Name",type:"text",required:true},
      {id:"spouse_name",label:"Spouse's Name",type:"text"},
      {id:"address",label:"Address",type:"text"},
      {id:"city",label:"City",type:"text"},
      {id:"zip",label:"ZIP Code",type:"text"},
      {id:"home_phone",label:"Home Phone",type:"tel"},
      {id:"cell_phone",label:"Cell Phone",type:"tel",required:true},
      {id:"email",label:"Email Address",type:"email",required:true},
      {id:"spouse_cell",label:"Spouse's Cell Phone",type:"tel"},
      {id:"spouse_email",label:"Spouse's Email",type:"email"},
      {id:"concerns",label:"Areas of Concern (check all that apply)",type:"checkboxes",options:["Retirement Preparation","Mortgage","Saving for College","Caring for Parents","Savings and Investments","Final Expenses","Income Taxes","Long Term Care","Major Purchase / Lease","Estate & Inheritance Considerations"]},
      {id:"has_401k",label:"Do you have a 401(k) through work?",type:"radio",options:["Yes","No"]},
      {id:"job_change",label:"Have you changed jobs in the last 5 years?",type:"radio",options:["Yes","No"]},
      {id:"review_401k",label:"Would you like us to review your 401(k)?",type:"radio",options:["Yes","No","N/A"]},
      {id:"has_ira",label:"Do you have a Traditional or Roth IRA?",type:"radio",options:["Yes","No"]},
      {id:"discuss_ira",label:"Would you like to discuss IRA options?",type:"radio",options:["Yes","No"]},
      {id:"has_life",label:"Do you have Life Insurance?",type:"radio",options:["Yes","No"]},
      {id:"life_10x",label:"If Yes, is it 10x your salary?",type:"radio",options:["Yes","No","N/A"]},
      {id:"employer_life",label:"Is it through your employer?",type:"radio",options:["Yes","No","N/A"]},
      {id:"discuss_life",label:"Would you like to discuss Life Insurance Options?",type:"radio",options:["Yes","No"]},
    ]
  },
  {
    id:"customer-profile",
    title:"Customer Profile Worksheet",
    formNum:"31-4996",
    icon:"👤",
    color:"#553c9a", bg:"#faf5ff",
    desc:"Full fact-find with financial goals, KYC data, savings inventory, income/expenses, and 6-question risk tolerance assessment producing a Conservative/Moderate/Aggressive investor profile.",
    tags:["Fact-Find","Risk Tolerance","KYC","Suitability"],
    fields:[
      {id:"date",label:"Date",type:"date",required:true},
      {id:"first_name",label:"First Name",type:"text",required:true},
      {id:"last_name",label:"Last Name",type:"text",required:true},
      {id:"dob",label:"Date of Birth",type:"date",required:true},
      {id:"ssn_last4",label:"Last 4 of SSN",type:"text"},
      {id:"gender",label:"Gender",type:"select",options:["Male","Female","Prefer not to say"]},
      {id:"marital_status",label:"Marital Status",type:"select",options:["Single","Married","Divorced","Widowed"]},
      {id:"citizenship",label:"Citizenship Type",type:"select",options:["US Citizen","Permanent Resident","Other"]},
      {id:"home_address",label:"Home Address",type:"text"},
      {id:"city",label:"City",type:"text"},
      {id:"state",label:"State",type:"text"},
      {id:"zip",label:"ZIP Code",type:"text"},
      {id:"cell_phone",label:"Cell Phone",type:"tel",required:true},
      {id:"email",label:"Email",type:"email",required:true},
      {id:"employer",label:"Employer",type:"text"},
      {id:"occupation",label:"Occupation",type:"text"},
      {id:"dependents",label:"Number of Dependents",type:"number"},
      {id:"annual_income",label:"Annual Income (Client)",type:"number",prefix:"$"},
      {id:"spouse_income",label:"Annual Income (Spouse)",type:"number",prefix:"$"},
      {id:"household_debt",label:"Estimated Household Debt",type:"number",prefix:"$"},
      {id:"net_worth",label:"Estimated Net Worth",type:"number",prefix:"$"},
      {id:"tax_bracket",label:"Estimated Federal Tax Bracket",type:"select",options:["10%","12%","22%","24%","32%","35%","37%"]},
      {id:"goal_1",label:"Concern: Investing for college education",type:"radio",options:["Not really","Somewhat","Very concerned"]},
      {id:"goal_2",label:"Concern: Saving for a major purchase",type:"radio",options:["Not really","Somewhat","Very concerned"]},
      {id:"goal_3",label:"Concern: Meeting survivorship needs",type:"radio",options:["Not really","Somewhat","Very concerned"]},
      {id:"goal_4",label:"Concern: Investing for retirement",type:"radio",options:["Not really","Somewhat","Very concerned"]},
      {id:"goal_5",label:"Concern: Long term care protection",type:"radio",options:["Not really","Somewhat","Very concerned"]},
      {id:"goal_6",label:"Concern: Income needs in case of disability",type:"radio",options:["Not really","Somewhat","Very concerned"]},
      {id:"goal_7",label:"Concern: Life Insurance",type:"radio",options:["Not really","Somewhat","Very concerned"]},
      {id:"risk_q1",label:"Risk Q1: Investment objective",type:"radio",options:["Current income (1)","Tax-free income (2)","Asset growth with current income (3)","Maximum capital appreciation (4)"]},
      {id:"risk_q2",label:"Risk Q2: Comfortable with investments that may go down in value?",type:"radio",options:["Strongly disagree (1)","Disagree (2)","Somewhat agree (3)","Agree (4)","Strongly agree (5)"]},
      {id:"risk_q3",label:"Risk Q3: Investment experience",type:"radio",options:["Never invested (1)","Invested in bonds only (2)","Only through employer plan (3)","Some experience (4)","Extensive experience (5)"]},
      {id:"risk_q4",label:"Risk Q4: How long could you cover living expenses with liquid assets?",type:"radio",options:["1 month or less (1)","1–3 months (2)","3–6 months (3)","6–12 months (4)","12+ months (5)"]},
      {id:"risk_q5",label:"Risk Q5: Outlook for future income over next 5 years",type:"radio",options:["Will greatly decrease (1)","Will decrease slightly (2)","Will stay the same (3)","Will increase slightly (4)","Will greatly increase (5)"]},
      {id:"risk_q6",label:"Risk Q6: Age range",type:"radio",options:["61 and older (1)","41 to 60 (2)","18 to 40 (3)"]},
      {id:"time_horizon",label:"Investment Time Horizon",type:"select",options:["1–3 years","3–7 years","7–10 years","10–15 years","15+ years"]},
    ]
  },
  {
    id:"liability-exposure",
    title:"Liability Exposure Worksheet",
    formNum:"31-8352",
    icon:"⚖️",
    color:"#e53e3e", bg:"#fff5f5",
    desc:"Declaration of assets calculating total assets at risk. Covers real estate equity, wage garnishment potential, personal property, investments, retirement assets, and existing life insurance.",
    tags:["Assets","Life Insurance","Protection","Net Worth"],
    fields:[
      {id:"client_name",label:"Client Name",type:"text",required:true},
      {id:"home_market",label:"Home — Market Value",type:"number",prefix:"$"},
      {id:"home_mortgage",label:"Home — Mortgage",type:"number",prefix:"$"},
      {id:"home2_market",label:"2nd Home/Land — Market Value",type:"number",prefix:"$"},
      {id:"home2_mortgage",label:"2nd Home/Land — Mortgage",type:"number",prefix:"$"},
      {id:"rental_market",label:"Rental Property — Market Value",type:"number",prefix:"$"},
      {id:"rental_mortgage",label:"Rental Property — Mortgage",type:"number",prefix:"$"},
      {id:"business_market",label:"Business Property — Market Value",type:"number",prefix:"$"},
      {id:"business_mortgage",label:"Business Property — Mortgage",type:"number",prefix:"$"},
      {id:"name1",label:"Name 1 (for income calc)",type:"text"},
      {id:"income1",label:"Annual Income — Name 1",type:"number",prefix:"$"},
      {id:"name2",label:"Name 2 (for income calc)",type:"text"},
      {id:"income2",label:"Annual Income — Name 2",type:"number",prefix:"$"},
      {id:"personal_contents",label:"Personal Contents Value",type:"number",prefix:"$"},
      {id:"autos",label:"Autos Value",type:"number",prefix:"$"},
      {id:"rec_vehicles",label:"Recreational Vehicles",type:"number",prefix:"$"},
      {id:"firearms",label:"Firearms",type:"number",prefix:"$"},
      {id:"digital",label:"Digital / Computer Equipment",type:"number",prefix:"$"},
      {id:"jewelry",label:"Jewelry",type:"number",prefix:"$"},
      {id:"art",label:"Art / Collectables",type:"number",prefix:"$"},
      {id:"other_personal",label:"Other Valuables",type:"number",prefix:"$"},
      {id:"annuities",label:"Annuities",type:"number",prefix:"$"},
      {id:"bank_cds",label:"Bank CDs",type:"number",prefix:"$"},
      {id:"savings",label:"Savings",type:"number",prefix:"$"},
      {id:"stocks_mutual",label:"Stocks / Mutual Funds",type:"number",prefix:"$"},
      {id:"bonds",label:"Bonds",type:"number",prefix:"$"},
      {id:"iras",label:"IRAs",type:"number",prefix:"$"},
      {id:"401k",label:"401(k) / Profit Sharing",type:"number",prefix:"$"},
      {id:"sep_simple",label:"SEP / SIMPLE",type:"number",prefix:"$"},
      {id:"business_assets",label:"Business Assets",type:"number",prefix:"$"},
      {id:"cash_other",label:"Cash / Other",type:"number",prefix:"$"},
      {id:"life_name1",label:"Life Insurance — Person 1 Name",type:"text"},
      {id:"life_term1",label:"Life Insurance — Person 1 Term Amount",type:"number",prefix:"$"},
      {id:"life_perm1",label:"Life Insurance — Person 1 Permanent Amount",type:"number",prefix:"$"},
      {id:"life_employer1",label:"Life Insurance — Person 1 Employer Amount",type:"number",prefix:"$"},
    ]
  },
  {
    id:"cash-flow",
    title:"Cash Flow Statement",
    formNum:"31-8422",
    icon:"💵",
    color:"#38a169", bg:"#f0fff4",
    desc:"Detailed income vs. expense worksheet covering household, transportation, living expenses, family care, medical, taxes, and discretionary spending to identify available cash flow for premiums.",
    tags:["Budget","Income","Expenses","Premium Sizing"],
    fields:[
      {id:"client_name",label:"Client Name",type:"text",required:true},
      {id:"gross_income_client",label:"Client Gross Monthly Income",type:"number",prefix:"$"},
      {id:"net_income_client",label:"Client Net Monthly Income",type:"number",prefix:"$"},
      {id:"gross_income_spouse",label:"Spouse Gross Monthly Income",type:"number",prefix:"$"},
      {id:"net_income_spouse",label:"Spouse Net Monthly Income",type:"number",prefix:"$"},
      {id:"other_income",label:"Other Monthly Income",type:"number",prefix:"$"},
      {id:"mortgage_rent",label:"Mortgage/Rent",type:"number",prefix:"$"},
      {id:"property_taxes",label:"Property Taxes (monthly)",type:"number",prefix:"$"},
      {id:"home_insurance",label:"Home/Renter Insurance",type:"number",prefix:"$"},
      {id:"utilities",label:"Utilities",type:"number",prefix:"$"},
      {id:"phone",label:"Telephone/Cell Phone",type:"number",prefix:"$"},
      {id:"loans_debt",label:"Loans/Debt Payments",type:"number",prefix:"$"},
      {id:"car_payment",label:"Car Payment",type:"number",prefix:"$"},
      {id:"car_insurance",label:"Car Insurance",type:"number",prefix:"$"},
      {id:"gasoline",label:"Gasoline",type:"number",prefix:"$"},
      {id:"food",label:"Food",type:"number",prefix:"$"},
      {id:"clothing",label:"Clothing",type:"number",prefix:"$"},
      {id:"childcare",label:"Child/Parent Care",type:"number",prefix:"$"},
      {id:"education",label:"Education",type:"number",prefix:"$"},
      {id:"health_insurance",label:"Health Insurance",type:"number",prefix:"$"},
      {id:"life_insurance",label:"Existing Life Insurance Premiums",type:"number",prefix:"$"},
      {id:"medical",label:"Medical/Dental Expenses",type:"number",prefix:"$"},
      {id:"federal_tax",label:"Federal Tax (monthly)",type:"number",prefix:"$"},
      {id:"state_tax",label:"State Tax (monthly)",type:"number",prefix:"$"},
      {id:"entertainment",label:"Entertainment/Dining/Hobbies",type:"number",prefix:"$"},
      {id:"travel",label:"Travel/Vacations",type:"number",prefix:"$"},
      {id:"charitable",label:"Charitable Donations",type:"number",prefix:"$"},
      {id:"other_expenses",label:"Other Expenses",type:"number",prefix:"$"},
    ]
  },
  {
    id:"financial-position",
    title:"Statement of Financial Position",
    formNum:"326578",
    icon:"📊",
    color:"#dd6b20", bg:"#fffaf0",
    desc:"Full personal balance sheet. Assets by tax status (tax-free, tax-deferred, taxable), liabilities, net worth, life insurance inventory, minor assets, and net worth trend tracker.",
    tags:["Net Worth","Balance Sheet","Tax Status","Estate"],
    fields:[
      {id:"client_name",label:"Client Name",type:"text",required:true},
      {id:"prepared_date",label:"Prepared As Of",type:"date",required:true},
      {id:"checking_savings",label:"Checking/Savings Total",type:"number",prefix:"$"},
      {id:"roth_ira",label:"Roth IRA (Tax-Free)",type:"number",prefix:"$"},
      {id:"trad_ira",label:"Traditional IRA (Tax-Deferred)",type:"number",prefix:"$"},
      {id:"401k_val",label:"401(k) / 403(b) (Tax-Deferred)",type:"number",prefix:"$"},
      {id:"taxable_investments",label:"Taxable Investment Accounts",type:"number",prefix:"$"},
      {id:"annuity_val",label:"Annuities",type:"number",prefix:"$"},
      {id:"other_investments",label:"Other Investments",type:"number",prefix:"$"},
      {id:"residence_value",label:"Residence Estimated Value",type:"number",prefix:"$"},
      {id:"personal_property",label:"Personal Property Value",type:"number",prefix:"$"},
      {id:"auto_value",label:"Auto(s) Value",type:"number",prefix:"$"},
      {id:"mortgage_bal",label:"Mortgage Balance",type:"number",prefix:"$"},
      {id:"student_loans",label:"Student Loans",type:"number",prefix:"$"},
      {id:"auto_loan",label:"Auto Loan",type:"number",prefix:"$"},
      {id:"credit_card",label:"Credit Card Debt",type:"number",prefix:"$"},
      {id:"other_debt",label:"Other Liabilities",type:"number",prefix:"$"},
      {id:"life_ins_type",label:"Life Insurance Type (Term/Permanent)",type:"select",options:["Term","Permanent","Both"]},
      {id:"life_ins_death_benefit",label:"Total Life Insurance Death Benefit",type:"number",prefix:"$"},
      {id:"life_ins_cash_value",label:"Life Insurance Cash Value (if permanent)",type:"number",prefix:"$"},
      {id:"529_utma",label:"529 / UTMA / College Savings",type:"number",prefix:"$"},
    ]
  },
  {
    id:"business-questionnaire",
    title:"Business Information Questionnaire",
    formNum:"6151379.1",
    icon:"🏢",
    color:"#553c9a", bg:"#faf5ff",
    desc:"Business owner fact-find covering entity structure, ownership, employees, existing benefit plans, buy-sell agreement status, financial data, and business planning priorities.",
    tags:["Business Owner","Buy-Sell","Key Man","Retirement Plan"],
    fields:[
      {id:"business_name",label:"Business Name",type:"text",required:true},
      {id:"business_address",label:"Business Address",type:"text"},
      {id:"business_structure",label:"Business Structure",type:"select",options:["Sole Proprietor","Partnership","LLC","S-Corp","C-Corp","Other"]},
      {id:"nature_of_business",label:"Nature of Business",type:"text"},
      {id:"year_established",label:"Year Established",type:"number"},
      {id:"fein",label:"FEIN / Tax ID",type:"text"},
      {id:"owner1_name",label:"Owner 1 — Name",type:"text",required:true},
      {id:"owner1_dob",label:"Owner 1 — Date of Birth",type:"date"},
      {id:"owner1_pct",label:"Owner 1 — % Ownership",type:"number"},
      {id:"owner2_name",label:"Owner 2 — Name (if applicable)",type:"text"},
      {id:"owner2_pct",label:"Owner 2 — % Ownership",type:"number"},
      {id:"ft_employees",label:"Full-Time Employees",type:"number"},
      {id:"pt_employees",label:"Part-Time Employees",type:"number"},
      {id:"has_key_employee",label:"Are there key employees that drive revenue?",type:"radio",options:["Yes","No"]},
      {id:"has_buy_sell",label:"Do you have a buy-sell agreement?",type:"radio",options:["Yes","No"]},
      {id:"buy_sell_funded",label:"Is the buy-sell agreement funded?",type:"radio",options:["Yes","No","N/A"]},
      {id:"life_ins_amount",label:"Life Insurance Amount (buy-sell)",type:"number",prefix:"$"},
      {id:"has_401k",label:"Do you have a 401(k) plan?",type:"radio",options:["Yes","No"]},
      {id:"has_sep",label:"Do you have a SEP IRA?",type:"radio",options:["Yes","No"]},
      {id:"has_pension",label:"Do you have a Pension Plan?",type:"radio",options:["Yes","No"]},
      {id:"total_assets",label:"Total Business Assets",type:"number",prefix:"$"},
      {id:"total_liabilities",label:"Total Business Liabilities",type:"number",prefix:"$"},
      {id:"business_value",label:"Estimated Value of Business",type:"number",prefix:"$"},
      {id:"net_income_1",label:"Net Income — Year 1 (most recent)",type:"number",prefix:"$"},
      {id:"net_income_2",label:"Net Income — Year 2",type:"number",prefix:"$"},
      {id:"net_income_3",label:"Net Income — Year 3",type:"number",prefix:"$"},
      {id:"priority_exit",label:"Priority: Exit Planning (1–5)",type:"select",options:["1","2","3","4","5"]},
      {id:"priority_protection",label:"Priority: Business Protection (1–5)",type:"select",options:["1","2","3","4","5"]},
      {id:"priority_retirement",label:"Priority: Business Owner Retirement (1–5)",type:"select",options:["1","2","3","4","5"]},
      {id:"attorney",label:"Business Attorney Name",type:"text"},
      {id:"cpa",label:"CPA Name",type:"text"},
    ]
  },
  {
    id:"financial-needs-analysis",
    title:"Financial Needs Analysis Intake",
    formNum:"FNA-001",
    icon:"🎯",
    color:"#b7791f", bg:"#fffff0",
    desc:"Comprehensive intake form combining personal info, financial position, goals, risk tolerance, and retirement details to generate a professional AI-powered Financial Needs Analysis report.",
    tags:["FNA","Comprehensive","AI Report","All-in-One"],
    fields:[
      {id:"first_name",label:"First Name",type:"text",required:true},
      {id:"last_name",label:"Last Name",type:"text",required:true},
      {id:"dob",label:"Date of Birth",type:"date",required:true},
      {id:"email",label:"Email",type:"email",required:true},
      {id:"phone",label:"Phone",type:"tel",required:true},
      {id:"marital_status",label:"Marital Status",type:"select",options:["Single","Married","Divorced","Widowed"]},
      {id:"dependents",label:"Number of Dependents",type:"number"},
      {id:"employer",label:"Employer / Occupation",type:"text"},
      {id:"annual_income",label:"Annual Household Income",type:"number",prefix:"$",required:true},
      {id:"monthly_savings",label:"Monthly Savings / Investment Amount",type:"number",prefix:"$"},
      {id:"net_worth",label:"Estimated Net Worth",type:"number",prefix:"$"},
      {id:"has_401k",label:"Do you have a 401(k) or employer retirement plan?",type:"radio",options:["Yes","No"]},
      {id:"401k_balance",label:"401(k) / Retirement Plan Balance",type:"number",prefix:"$"},
      {id:"has_ira",label:"Do you have an IRA?",type:"radio",options:["Yes — Traditional","Yes — Roth","Yes — Both","No"]},
      {id:"ira_balance",label:"IRA Balance",type:"number",prefix:"$"},
      {id:"has_life_ins",label:"Do you have life insurance?",type:"radio",options:["Yes — Term","Yes — Permanent","Yes — Both","No"]},
      {id:"life_coverage",label:"Total Life Insurance Coverage",type:"number",prefix:"$"},
      {id:"life_coverage_adequate",label:"Do you feel your life insurance coverage is adequate?",type:"radio",options:["Yes","No","Not Sure"]},
      {id:"retirement_age",label:"Target Retirement Age",type:"number"},
      {id:"retirement_income_goal",label:"Desired Monthly Income in Retirement",type:"number",prefix:"$"},
      {id:"social_security",label:"Expected Monthly Social Security Benefit",type:"number",prefix:"$"},
      {id:"primary_concern",label:"What is your #1 financial concern right now?",type:"select",options:["Retirement income","Life insurance gap","Debt reduction","College funding","Tax reduction","Business succession","Estate planning","Market volatility"]},
      {id:"secondary_concern",label:"Secondary financial concern",type:"select",options:["Retirement income","Life insurance gap","Debt reduction","College funding","Tax reduction","Business succession","Estate planning","Market volatility","None"]},
      {id:"risk_tolerance",label:"How would you describe your investment risk tolerance?",type:"radio",options:["Conservative — preserve principal","Moderate — balanced growth and protection","Aggressive — maximize long-term growth"]},
      {id:"investment_horizon",label:"Investment Time Horizon",type:"select",options:["Less than 5 years","5–10 years","10–20 years","20+ years"]},
      {id:"emergency_fund",label:"Do you have 3–6 months of expenses saved as an emergency fund?",type:"radio",options:["Yes","No","Partially"]},
      {id:"estate_docs",label:"Do you have a will or estate planning documents?",type:"radio",options:["Yes — up to date","Yes — needs updating","No"]},
      {id:"business_owner",label:"Are you a business owner?",type:"radio",options:["Yes","No"]},
      {id:"long_term_care",label:"Have you considered long-term care insurance?",type:"radio",options:["Yes — have coverage","Yes — interested","No — not a priority","Not sure what it is"]},
      {id:"additional_notes",label:"Anything else you'd like us to know before your review?",type:"textarea"},
    ]
  }
];

// ── MOCK SUBMITTED RESPONSES ─────────────────────────────
// ── HELPERS ──────────────────────────────────────────────
const fmt = n => n ? "$" + Number(n).toLocaleString("en-US") : "—";
const calcRiskScore = data => {
  const keys = ["risk_q1","risk_q2","risk_q3","risk_q4","risk_q5","risk_q6"];
  let score = 0;
  keys.forEach(k => { if(data[k]) { const m = data[k].match(/\((\d)\)/); if(m) score += parseInt(m[1]); } });
  if(score >= 23) return {score, label:"Aggressive", profile:5};
  if(score >= 13) return {score, label:"Moderate", profile:3};
  return {score, label:"Conservative", profile:1};
};

// ── TOAST ────────────────────────────────────────────────
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const add = (msg, type="info") => {
    const id = Date.now();
    setToasts(t => [...t, {id, msg, type}]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  };
  return {toasts, add};
}

// ── SEND MODAL ───────────────────────────────────────────
function SendModal({form, onClose, toast}) {
  const [client, setClient] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState("email");
  const [sending, setSending] = useState(false);
  const [sentLink, setSentLink] = useState("");

  const send = async () => {
    if(!client) { toast("Client name is required", "error"); return; }
    const wantsLink = channel === "copy-link";
    const effChannel = wantsLink ? "link" : channel;
    if((effChannel === "email" || effChannel === "both") && !email) { toast("Email is required", "error"); return; }
    if((effChannel === "sms" || effChannel === "both") && !phone) { toast("Phone is required", "error"); return; }

    setSending(true);
    try {
      const res = await fetch("/api/forms/send", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          form_id: form?.id,
          channel: effChannel,
          email,
          phone,
          client_name: client,
        }),
      });
      const data = await res.json();
      if(data.success) {
        setSentLink(data.link || "");
        if(wantsLink) {
          navigator.clipboard?.writeText(data.link || "");
          toast("Form link created & copied to clipboard", "success");
        } else {
          toast(`✓ ${form?.title} sent to ${client} via ${channel}`, "success");
          setTimeout(onClose, 1500);
        }
      } else {
        toast(data.message || data.error || "Failed to send form", data.reason === "already_complete" ? "info" : "error");
      }
    } catch(e) {
      toast("Network error sending form", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`modal-overlay ${form ? "open" : ""}`} onClick={e => e.target.className.includes("modal-overlay") && onClose()}>
      <div className="modal">
        <div className="modal-title">Send Form — {form?.title}</div>
        <div className="field"><label>Client Name</label><input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Mary Jones"/></div>
        <div className="field"><label>Send Via</label>
          <select value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="both">Both Email + SMS</option>
            <option value="copy-link">Copy link only</option>
          </select>
        </div>
        {(channel === "email" || channel === "both") && <div className="field"><label>Client Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com"/></div>}
        {(channel === "sms" || channel === "both") && <div className="field"><label>Client Phone</label><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="2145551234"/></div>}
        {sentLink && (
          <div className="field">
            <label>Secure Link</label>
            <div className="link-preview">
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sentLink}</span>
              <button className="copy-btn" onClick={() => { navigator.clipboard?.writeText(sentLink); toast("Link copied!", "success"); }}>Copy</button>
            </div>
            <div style={{fontSize:10, color:"var(--muted)", marginTop:5}}>Link expires in 30 days. Client fills out the form — response stored in Supabase automatically.</div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={send} disabled={sending}>{sending?"Sending…":"Send Form →"}</button>
        </div>
      </div>
    </div>
  );
}

// ── FNA GENERATOR ────────────────────────────────────────
function FNAGenerator({toast}) {
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [subLoading, setSubLoading] = useState(true);

  useEffect(() => {
    // Live submitted forms eligible for FNA generation
    fetch("/api/forms/responses?status=complete&limit=50")
      .then(r => r.json())
      .then(d => {
        const subs = (d.submissions || []).filter(s =>
          ["financial-needs-analysis","customer-profile","customer-questionnaire"].includes(s.form_id)
        );
        setSubmissions(subs);
        setSubLoading(false);
      })
      .catch(() => { setSubmissions([]); setSubLoading(false); });
  }, []);

  const subName = (s) => s.customers ? `${s.customers.first_name||""} ${s.customers.last_name||""}`.trim()||"Client" : "Client";
  const subDate = (s) => s.submitted_at ? new Date(s.submitted_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

  const generateReport = async () => {
    if(!selected) { toast("Select a client first", "error"); return; }
    setLoading(true); setReport(null);
    try {
      const res = await fetch("/api/forms/fna", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ submission_id: selected }),
      });
      const data = await res.json();
      if(data.success) {
        const sub = submissions.find(s => s.submission_id === selected);
        setReport({ client: subName(sub||{}), data: sub?.response_data||{}, analysis: data.report, generated_at: new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}) });
        toast("✓ FNA report generated successfully", "success");
      } else { toast(data.error || "Failed to generate FNA", "error"); }
    } catch(e) { toast("Error generating FNA", "error"); }
    setLoading(false);
  };

  const printReport = () => window.print();

  return (
    <div>
      <div className="fna-wrap">
        <div className="fna-left">
          <div className="fna-card">
            <div className="fna-card-title">🎯 Generate Financial Needs Analysis</div>
            <div className="field">
              <label>Select Client (from submitted forms)</label>
              <select value={selected} onChange={e => setSelected(e.target.value)}>
                <option value="">{subLoading ? "Loading submissions…" : submissions.length===0 ? "— No submissions yet —" : "— Select a client —"}</option>
                {submissions.map(s => <option key={s.submission_id} value={s.submission_id}>{subName(s)} — {s.form_id.split("-").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ")} ({subDate(s)})</option>)}
              </select>
            </div>
            {selected && (
              <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px",marginBottom:12,fontSize:11}}>
                <div style={{fontWeight:600,marginBottom:4}}>Data available for this client:</div>
                {Object.entries(submissions.find(s=>s.submission_id===selected)?.response_data||{}).slice(0,6).map(([k,v])=>
                  <div key={k} style={{display:"flex",gap:8,padding:"2px 0",borderBottom:"1px solid var(--border)"}}>
                    <span style={{color:"var(--muted)",fontFamily:"DM Mono,monospace",fontSize:9,width:140,flexShrink:0}}>{k}</span>
                    <span style={{color:"var(--text)",fontSize:11}}>{String(v).substring(0,40)}</span>
                  </div>
                )}
                <div style={{fontSize:9,color:"var(--muted)",marginTop:4}}>+ more fields in the submitted form</div>
              </div>
            )}
            <button className="btn-gold" style={{width:"100%",padding:10}} onClick={generateReport}>
              ✦ Generate FNA Report with Claude AI →
            </button>
            <div style={{fontSize:10,color:"var(--muted)",marginTop:8,textAlign:"center"}}>Uses Claude Sonnet via your Max plan. No extra cost.</div>
          </div>

          <div className="fna-card" style={{background:"var(--navy)",color:"#fff"}}>
            <div className="fna-card-title" style={{color:"#fff",borderBottomColor:"rgba(255,255,255,.15)"}}>📋 FNA Compliance Notice</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.7)",lineHeight:1.7}}>
              The generated report is an educational tool only. It does not constitute financial advice, a product recommendation, or a suitability determination.<br/><br/>
              All product discussions require:<br/>
              • A licensed FSA meeting<br/>
              • Completed Customer Profile Worksheet (risk tolerance)<br/>
              • FINRA Reg BI best-interest suitability review<br/>
              • Principal approval for variable/annuity products<br/><br/>
              Call FFS Sales Desk before any presentation: <strong style={{color:"#4299e1"}}>(866) 888-9739 Opt 3→3</strong>
            </div>
          </div>
        </div>

        <div>
          {loading && (
            <div className="fna-report">
              <div className="loading-state">
                <div className="loading-spinner"/>
                <div style={{fontWeight:600,marginBottom:4}}>Generating FNA Report...</div>
                <div style={{fontSize:11,color:"var(--muted)"}}>Claude is analyzing the client's financial data and generating a professional report.</div>
              </div>
            </div>
          )}

          {report && !loading && (
            <div className="fna-report" id="fna-print">
              <div className="report-header">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{fontSize:10,color:"var(--muted)",fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Farmers Financial Solutions, LLC · CONFIDENTIAL</div>
                    <div className="report-title">Financial Needs Analysis</div>
                    <div className="report-sub">{report.client} · Prepared {report.generated_at}</div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <span style={{background:report.analysis.urgency==="High"?"var(--red-bg)":report.analysis.urgency==="Medium"?"var(--orange-bg)":"var(--green-bg)",color:report.analysis.urgency==="High"?"var(--red)":report.analysis.urgency==="Medium"?"var(--orange)":"var(--green)",border:`1px solid ${report.analysis.urgency==="High"?"var(--red-border)":report.analysis.urgency==="Medium"?"var(--orange-border)":"var(--green-border)"}`,padding:"4px 10px",borderRadius:4,fontSize:10,fontFamily:"DM Mono,monospace",fontWeight:700}}>
                      {report.analysis.urgency} URGENCY
                    </span>
                    <button className="btn-secondary" onClick={printReport} style={{fontSize:10,padding:"4px 10px"}}>⊕ Print / PDF</button>
                  </div>
                </div>
              </div>

              <div className="report-section">
                <div className="rs-title">Executive Summary</div>
                <div className="rs-content">{report.analysis.executive_summary}</div>
              </div>

              <div className="report-section">
                <div className="rs-title">Current Financial Position</div>
                <div className="rs-content">{report.analysis.financial_position}</div>
                <div className="rs-grid">
                  {report.data.annual_income && <div className="rs-item"><div className="rs-item-label">Annual Income</div><div className="rs-item-val">{fmt(report.data.annual_income)}</div></div>}
                  {report.data.net_worth && <div className="rs-item"><div className="rs-item-label">Est. Net Worth</div><div className="rs-item-val">{fmt(report.data.net_worth)}</div></div>}
                  {report.data.risk_tolerance && <div className="rs-item"><div className="rs-item-label">Risk Tolerance</div><div className="rs-item-val">{report.data.risk_tolerance.split(" — ")[0]}</div></div>}
                  {report.data.retirement_age && <div className="rs-item"><div className="rs-item-label">Target Retirement Age</div><div className="rs-item-val">{report.data.retirement_age}</div></div>}
                  {report.data.retirement_income_goal && <div className="rs-item"><div className="rs-item-label">Retirement Income Goal</div><div className="rs-item-val">{fmt(report.data.retirement_income_goal)}/mo</div></div>}
                  {report.data.life_coverage && <div className="rs-item"><div className="rs-item-label">Life Coverage</div><div className="rs-item-val">{fmt(report.data.life_coverage)}</div></div>}
                </div>
              </div>

              <div className="report-section">
                <div className="rs-title">Identified Gaps & Opportunities</div>
                {report.analysis.gaps.map((g,i) => (
                  <div key={i} style={{display:"flex",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:12}}>
                    <span style={{color:"var(--orange)",fontFamily:"DM Mono,monospace",fontSize:10,flexShrink:0,marginTop:1}}>⚑ {i+1}</span>
                    <span style={{color:"var(--text)"}}>{g}</span>
                  </div>
                ))}
              </div>

              <div className="report-section">
                <div className="rs-title">Prioritized Recommendations</div>
                {report.analysis.recommendations.map((r,i) => (
                  <div className="priority-rec" key={i}>
                    <div className="pr-num">PRIORITY {r.priority} · {r.product_category}</div>
                    <div className="pr-title">{r.title}</div>
                    <div className="pr-body">{r.description}</div>
                  </div>
                ))}
              </div>

              <div className="report-section">
                <div className="rs-title">Next Steps</div>
                {report.analysis.next_steps.map((s,i) => (
                  <div key={i} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:"1px solid var(--border)",fontSize:12}}>
                    <span style={{color:"var(--green2)",fontFamily:"DM Mono,monospace",fontSize:10,flexShrink:0,marginTop:1}}>→ {i+1}</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>

              <div className="disclaimer">
                This Financial Needs Analysis is prepared by Farmers Financial Solutions, LLC for informational and educational purposes only. It does not constitute investment advice, a securities recommendation, or a suitability determination. All recommendations require a licensed FSA meeting, completion of a Customer Profile Worksheet, and a FINRA Reg BI best-interest review. Securities offered through Farmers Financial Solutions, LLC, 31051 Agoura Road, Westlake Village, CA 91361, (818) 584-0200, Member FINRA & SIPC.
              </div>
            </div>
          )}

          {!loading && !report && (
            <div className="fna-report" style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:300}}>
              <div style={{textAlign:"center",color:"var(--muted)"}}>
                <div style={{fontSize:40,marginBottom:12}}>✦</div>
                <div style={{fontWeight:600,fontSize:14,marginBottom:6}}>Ready to generate</div>
                <div style={{fontSize:11}}>Select a client with a submitted FNA intake form, then click Generate.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RESPONSES VIEWER ─────────────────────────────────────
function ResponsesViewer({toast}) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    fetch("/api/forms/responses?limit=100")
      .then(r => { if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(d => {
        setSubmissions(d.submissions || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message||"Failed to load"); setSubmissions([]); setLoading(false); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const allResponses = submissions;
  const filtered = allResponses.filter(r => {
    const matchesFilter = filter === "all" || r.form_id === filter;
    const clientName = r.client || (r.customers ? `${r.customers.first_name||""} ${r.customers.last_name||""}`.trim() : "");
    const matchesSearch = !search || clientName.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const selectedResp = allResponses.find(r => (r.submission_id||r.id) === selected);
  const getClientName = (r) => r.client || (r.customers ? `${r.customers.first_name||""} ${r.customers.last_name||""}`.trim() : "Unknown");
  const getDate = (r) => {
    const d = r.submitted_at || r.sent_at;
    return d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
  };
  const getFormTitle = (r) => r.form_title || FORMS.find(f=>f.id===r.form_id)?.title || r.form_id || "—";
  const getResponseData = (r) => r.response_data || r.data || {};
  const getId = (r) => r.submission_id || r.id;

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <div>
        <div style={{marginBottom:10,display:"flex",gap:8}}>
          <input
            placeholder="Search by client name..."
            value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"6px 10px",fontSize:11,fontFamily:"DM Mono,monospace",color:"var(--text)",outline:"none",width:180}}
          />
          <select style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"6px 10px",fontSize:11,fontFamily:"DM Mono, monospace",color:"var(--text)"}} value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All Forms</option>
            {FORMS.map(f=><option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
          <span style={{fontSize:10,color:"var(--muted)",alignSelf:"center",marginLeft:"auto"}}>{filtered.length} responses</span>
        </div>
        {error && <div className="error-banner"><span>⚠ Couldn't load responses ({error}).</span><button onClick={refresh}>Retry</button></div>}
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
          {loading && <div style={{padding:"20px",textAlign:"center",color:"var(--muted)",fontSize:12}}>Loading responses…</div>}
          {!loading && !error && filtered.length === 0 && <div style={{padding:"20px",textAlign:"center",color:"var(--muted)",fontSize:12}}>No submitted forms yet</div>}
          {!loading && filtered.length > 0 && (
            <table className="resp-table">
              <thead><tr><th>Client</th><th>Form</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>{filtered.map(r=>(
                <tr key={getId(r)} style={{cursor:"pointer",background:selected===getId(r)?"var(--blue-bg)":"transparent"}} onClick={()=>setSelected(getId(r))}>
                  <td style={{fontWeight:500}}>{getClientName(r)}</td>
                  <td style={{fontSize:10,color:"var(--muted)"}}>{getFormTitle(r)}</td>
                  <td style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--muted)"}}>{getDate(r)}</td>
                  <td>
                    <span className={`status-dot ${r.status==="complete"?"complete":r.status==="opened"?"pending":"sent"}`}/>
                    <span style={{fontSize:10}}>{r.status||"complete"}</span>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <div>
        {selectedResp ? (
          <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:16,boxShadow:"var(--shadow)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>{getClientName(selectedResp)}</div>
                <div style={{fontSize:10,color:"var(--muted)",fontFamily:"DM Mono,monospace"}}>{getFormTitle(selectedResp)} · {getDate(selectedResp)}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button className="btn-secondary" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>window.print()}>Print</button>
                {selectedResp.form_id==="financial-needs-analysis"&&(
                  <button className="btn-gold" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>toast("Switch to FNA Generator tab to generate report","info")}>✦ FNA</button>
                )}
              </div>
            </div>
            <div style={{maxHeight:400,overflowY:"auto"}}>
              {Object.entries(getResponseData(selectedResp)).length === 0
                ? <div style={{color:"var(--muted)",fontSize:12,textAlign:"center",padding:20}}>No response data recorded</div>
                : Object.entries(getResponseData(selectedResp)).map(([k,v])=>(
                  <div key={k} style={{display:"grid",gridTemplateColumns:"140px 1fr",gap:8,padding:"5px 0",borderBottom:"1px solid var(--border)",fontSize:11}}>
                    <div style={{color:"var(--muted)",fontFamily:"DM Mono,monospace",fontSize:9,textTransform:"uppercase",letterSpacing:".05em",paddingTop:1}}>{k.split("_").join(" ")}</div>
                    <div style={{color:"var(--text)",lineHeight:1.4}}>{Array.isArray(v)?v.join(", "):String(v)}</div>
                  </div>
                ))
              }
            </div>
          </div>
        ) : (
          <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:40,textAlign:"center",color:"var(--muted)",boxShadow:"var(--shadow)"}}>
            <div style={{fontSize:28,marginBottom:8}}>📄</div>
            <div style={{fontWeight:600,marginBottom:4}}>Select a response</div>
            <div style={{fontSize:11}}>Click any submitted form to view the full response.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SUPABASE SCHEMA ───────────────────────────────────────
function SchemaView() {
  return (
    <div>
      <div style={{fontSize:12,color:"var(--muted)",marginBottom:16}}>Run these in Supabase SQL Editor to add the forms system to your existing FSOS database.</div>
      {[
        {title:"form_submissions table", sql:`create table form_submissions (
  submission_id  uuid primary key default gen_random_uuid(),
  customer_id    uuid references customers(customer_id),
  agency_id      text references agencies(agency_id),
  form_id        text not null,          -- e.g. 'customer-questionnaire'
  form_title     text not null,
  token          text unique not null,   -- unique URL token per send
  status         text default 'sent',   -- sent | opened | complete | expired
  sent_at        timestamptz default now(),
  opened_at      timestamptz,
  submitted_at   timestamptz,
  expires_at     timestamptz default (now() + interval '30 days'),
  sent_via       text,                  -- email | sms | both | link
  response_data  jsonb,                 -- full form answers as JSON
  fna_report     jsonb,                 -- generated FNA report (if applicable)
  ip_address     text,
  created_at     timestamptz default now()
);

-- Index for fast token lookup (used on client form URL)
create unique index on form_submissions(token);
-- Index for customer lookup
create index on form_submissions(customer_id);
-- Index for form type queries
create index on form_submissions(form_id);`},
        {title:"form_sends log table", sql:`create table form_sends (
  send_id        uuid primary key default gen_random_uuid(),
  submission_id  uuid references form_submissions(submission_id),
  customer_id    uuid references customers(customer_id),
  form_id        text not null,
  channel        text not null,         -- email | sms
  destination    text not null,         -- email address or phone number
  sent_at        timestamptz default now(),
  delivered      boolean default false,
  opened_at      timestamptz
);`},
        {title:"Add fna_generated flag to commission_cases", sql:`-- When an FNA is generated and linked to a case
alter table commission_cases
  add column if not exists fna_submission_id uuid references form_submissions(submission_id),
  add column if not exists fna_generated_at  timestamptz,
  add column if not exists fna_urgency       text;  -- High | Medium | Low`},
        {title:"Update customer scoring on form submission", sql:`-- Trigger: when a customer_profile form is submitted,
-- update their risk tolerance and cohort in customer_profiles
create or replace function sync_form_to_profile()
returns trigger language plpgsql as $$
declare
  risk_score integer := 0;
  r text;
begin
  -- only fire for customer-profile form submissions
  if NEW.form_id != 'customer-profile' then return NEW; end if;
  if NEW.response_data is null then return NEW; end if;

  -- extract risk score from JSON response
  foreach r in array array[
    NEW.response_data->>'risk_q1',
    NEW.response_data->>'risk_q2',
    NEW.response_data->>'risk_q3',
    NEW.response_data->>'risk_q4',
    NEW.response_data->>'risk_q5',
    NEW.response_data->>'risk_q6'
  ] loop
    if r ~ '\\((\\d)\\)' then
      risk_score := risk_score + substring(r from '\\((\\d)\\)')::integer;
    end if;
  end loop;

  -- upsert customer profile with risk data
  insert into customer_profiles (customer_id, risk_score, risk_label, time_horizon, updated_at)
  values (
    NEW.customer_id,
    risk_score,
    case when risk_score >= 23 then 'Aggressive'
         when risk_score >= 13 then 'Moderate'
         else 'Conservative' end,
    NEW.response_data->>'time_horizon',
    now()
  )
  on conflict (customer_id) do update
    set risk_score = excluded.risk_score,
        risk_label = excluded.risk_label,
        time_horizon = excluded.time_horizon,
        updated_at = now();

  return NEW;
end;
$$;

create trigger form_submission_sync
  after update of status on form_submissions
  for each row when (NEW.status = 'complete')
  execute function sync_form_to_profile();`},
      ].map((s,i) => (
        <div key={i} style={{marginBottom:12}}>
          <div style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>{s.title}</div>
          <div style={{background:"#0f1e36",borderRadius:8,padding:"14px 16px",fontFamily:"DM Mono,monospace",fontSize:10,color:"#c8d4b8",lineHeight:1.9,overflowX:"auto",whiteSpace:"pre"}}>{s.sql}</div>
        </div>
      ))}
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// INLINE FORM FILLER — used by both FormsPage and FNAPage
// Renders any form's fields so FSA can fill on behalf of client
// ─────────────────────────────────────────────────────────
function InlineFormFiller({ form, onSave, onCancel, toast }) {
  const [data, setData] = useState({});
  const [section, setSection] = useState(0);

  // Group fields into chunks of ~8 for paged UX
  const chunkSize = 8;
  const allFields = form.fields;
  const totalSections = Math.ceil(allFields.length / chunkSize);
  const currentFields = allFields.slice(section * chunkSize, (section + 1) * chunkSize);
  const isLast = section === totalSections - 1;

  const set = (id, val) => setData(d => ({...d, [id]: val}));

  const calcRisk = () => {
    let score = 0;
    ["risk_q1","risk_q2","risk_q3","risk_q4","risk_q5","risk_q6"].forEach(k => {
      const v = data[k]; if(v){ const m = v.match(/\((\d)\)/); if(m) score += parseInt(m[1]); }
    });
    if(score >= 23) return {score, label:"Aggressive", color:"var(--red)"};
    if(score >= 13) return {score, label:"Moderate",   color:"var(--orange)"};
    if(score > 0)   return {score, label:"Conservative", color:"var(--blue)"};
    return null;
  };

  const calcAssets = () => {
    const equity = Math.max(0,(+data.home_market||0)-(+data.home_mortgage||0))
      + Math.max(0,(+data.home2_market||0)-(+data.home2_mortgage||0))
      + Math.max(0,(+data.rental_market||0)-(+data.rental_mortgage||0));
    const wages = ((+data.income1||0)+(+data.income2||0))*10*0.25;
    const personal = [data.personal_contents,data.autos,data.jewelry,data.other_personal].reduce((s,v)=>s+(+v||0),0);
    const invest = [data.iras,data["401k"],data.savings,data.stocks_mutual,data.annuities,data.cash_other].reduce((s,v)=>s+(+v||0),0);
    return equity+wages+personal+invest;
  };

  const fmtCur = n => n ? "$"+Number(n).toLocaleString("en-US") : "";

  const renderField = f => {
    const val = data[f.id] ?? "";
    const isChecks = f.type === "checkboxes";
    const vals = isChecks ? (Array.isArray(data[f.id]) ? data[f.id] : []) : null;

    return (
      <div key={f.id} className="field" style={{marginBottom:12}}>
        <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--text)",marginBottom:4}}>
          {f.label}{f.required && <span style={{color:"var(--red)",marginLeft:2}}>*</span>}
        </label>

        {f.type === "radio" && (
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {f.options.map(o => (
              <div key={o}
                onClick={() => set(f.id, o)}
                style={{display:"flex",alignItems:"center",gap:5,padding:"6px 10px",borderRadius:5,
                  border:`1.5px solid ${val===o?"var(--blue)":"var(--border)"}`,
                  background:val===o?"var(--blue-bg)":"var(--bg)",
                  cursor:"pointer",fontSize:11,color:val===o?"var(--blue)":"var(--text)",
                  fontWeight:val===o?500:400,transition:"all .12s"}}>
                <div style={{width:12,height:12,borderRadius:"50%",border:`2px solid ${val===o?"var(--blue)":"var(--dim)"}`,
                  background:val===o?"var(--blue)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {val===o && <div style={{width:4,height:4,borderRadius:"50%",background:"#fff"}}/>}
                </div>
                {o}
              </div>
            ))}
          </div>
        )}

        {isChecks && (
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {f.options.map(o => {
              const checked = vals.includes(o);
              return (
                <div key={o}
                  onClick={() => set(f.id, checked ? vals.filter(x=>x!==o) : [...vals, o])}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"6px 10px",borderRadius:5,
                    border:`1.5px solid ${checked?"var(--green-border)":"var(--border)"}`,
                    background:checked?"var(--green-bg)":"var(--bg)",
                    cursor:"pointer",fontSize:11,color:checked?"var(--green)":"var(--text)",transition:"all .12s"}}>
                  <div style={{width:12,height:12,borderRadius:3,border:`2px solid ${checked?"var(--green2)":"var(--dim)"}`,
                    background:checked?"var(--green2)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"#fff"}}>
                    {checked && "✓"}
                  </div>
                  {o}
                </div>
              );
            })}
          </div>
        )}

        {f.type === "select" && (
          <select value={val} onChange={e=>set(f.id,e.target.value)}
            style={{width:"100%",background:"var(--bg)",border:"1.5px solid var(--border)",borderRadius:5,padding:"8px 10px",fontFamily:"DM Sans,sans-serif",fontSize:12,color:"var(--text)",outline:"none"}}>
            <option value="">— select —</option>
            {f.options.map(o=><option key={o}>{o}</option>)}
          </select>
        )}

        {f.type === "textarea" && (
          <textarea value={val} onChange={e=>set(f.id,e.target.value)}
            style={{width:"100%",background:"var(--bg)",border:"1.5px solid var(--border)",borderRadius:5,padding:"8px 10px",fontFamily:"DM Sans,sans-serif",fontSize:12,color:"var(--text)",outline:"none",resize:"vertical",minHeight:72}}/>
        )}

        {!["radio","checkboxes","select","textarea"].includes(f.type) && (
          <div style={{position:"relative"}}>
            {f.prefix && <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--muted)",fontSize:12,pointerEvents:"none"}}>{f.prefix}</span>}
            <input
              type={f.type==="number"?"number":f.type==="date"?"date":f.type==="email"?"email":f.type==="tel"?"tel":"text"}
              value={val} onChange={e=>set(f.id,e.target.value)}
              style={{width:"100%",background:"var(--bg)",border:"1.5px solid var(--border)",borderRadius:5,
                padding:`8px 10px 8px ${f.prefix?"22px":"10px"}`,fontFamily:"DM Sans,sans-serif",
                fontSize:12,color:"var(--text)",outline:"none"}}/>
          </div>
        )}
      </div>
    );
  };

  const risk = form.id === "customer-profile" || form.id === "financial-needs-analysis" ? calcRisk() : null;
  const assetTotal = form.id === "liability-exposure" ? calcAssets() : null;
  const [clientName, setClientName] = useState("");
  const completedFields = Object.keys(data).filter(k => data[k] !== "" && data[k] !== null && !(Array.isArray(data[k]) && data[k].length === 0)).length;
  const pct = Math.round((completedFields / allFields.length) * 100);

  return (
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow2)"}}>
      {/* Header */}
      <div style={{background:`linear-gradient(135deg,${form.color},${form.color}cc)`,padding:"16px 20px",color:"#fff",display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:40,height:40,borderRadius:9,background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{form.icon}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:15,fontWeight:600}}>{form.title}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,.7)",marginTop:1}}>Form #{form.formNum} · Filling on behalf of client</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:20,fontWeight:700}}>{pct}%</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.7)",textTransform:"uppercase",letterSpacing:".06em"}}>Complete</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{height:4,background:"rgba(0,0,0,.08)"}}>
        <div style={{height:"100%",background:"#fff",opacity:.7,width:`${pct}%`,transition:"width .3s"}}/>
      </div>

      {/* CLIENT SELECTOR */}
      <div style={{padding:"12px 20px",background:"var(--gold-bg)",borderBottom:"1px solid var(--gold-border)",display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:11,fontWeight:600,color:"var(--gold)",fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".06em",flexShrink:0}}>Client</span>
        <input value={clientName} onChange={e=>setClientName(e.target.value)} placeholder="Enter client name to associate this form..."
          style={{flex:1,background:"var(--card)",border:"1px solid var(--gold-border)",borderRadius:5,padding:"6px 10px",fontFamily:"DM Sans,sans-serif",fontSize:12,color:"var(--text)",outline:"none"}}/>
        {clientName&&<span style={{fontSize:10,color:"var(--gold)"}}>✓ Will be linked to {clientName}</span>}
      </div>
      {/* Section nav */}
      {totalSections > 1 && (
        <div style={{display:"flex",padding:"10px 20px",background:"var(--bg2)",borderBottom:"1px solid var(--border)",gap:4,flexWrap:"wrap"}}>
          {Array.from({length:totalSections},(_,i)=>(
            <button key={i} onClick={()=>setSection(i)}
              style={{padding:"4px 10px",borderRadius:4,border:"none",fontSize:10,fontFamily:"DM Mono,monospace",cursor:"pointer",
                background:section===i?"var(--blue)":"var(--border)",color:section===i?"#fff":"var(--muted)",transition:"all .12s"}}>
              {i+1} of {totalSections}
            </button>
          ))}
          <span style={{marginLeft:"auto",fontSize:10,color:"var(--muted)",fontFamily:"DM Mono,monospace",alignSelf:"center"}}>
            Fields {section*chunkSize+1}–{Math.min((section+1)*chunkSize,allFields.length)} of {allFields.length}
          </span>
        </div>
      )}

      {/* Fields */}
      <div style={{padding:"20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        {currentFields.map(f => (
          <div key={f.id} style={{gridColumn: f.type==="checkboxes"||f.type==="textarea"||f.type==="radio"?"1/-1":"auto"}}>
            {renderField(f)}
          </div>
        ))}
      </div>

      {/* Live calculations */}
      {risk && (
        <div style={{margin:"0 20px 16px",padding:"12px 14px",borderRadius:7,border:`1px solid ${risk.color}44`,background:`${risk.color}11`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:11,color:"var(--muted)"}}>Risk Tolerance Score: <strong style={{color:"var(--text)"}}>{risk.score} / 27</strong></div>
            <div style={{fontSize:13,fontWeight:700,color:risk.color}}>{risk.label}</div>
          </div>
          <div style={{height:5,background:"var(--border)",borderRadius:3,marginTop:6,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(risk.score/27)*100}%`,background:risk.color,borderRadius:3,transition:"width .4s"}}/>
          </div>
        </div>
      )}
      {assetTotal > 0 && (
        <div style={{margin:"0 20px 16px",padding:"12px 14px",borderRadius:7,border:"1px solid var(--blue-border)",background:"var(--blue-bg)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:11,color:"var(--blue)",fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".06em"}}>Total Assets at Risk</div>
          <div style={{fontSize:20,fontWeight:700,color:"var(--navy)"}}>{"$"+assetTotal.toLocaleString("en-US")}</div>
        </div>
      )}

      {/* Footer actions */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderTop:"1px solid var(--border)",background:"var(--bg2)"}}>
        <button onClick={onCancel}
          style={{padding:"8px 16px",borderRadius:5,border:"1px solid var(--border)",background:"var(--card)",color:"var(--muted)",fontFamily:"DM Sans,sans-serif",fontSize:12,cursor:"pointer"}}>
          ← Back to Forms
        </button>
        <div style={{display:"flex",gap:8}}>
          {section > 0 && (
            <button onClick={()=>setSection(s=>s-1)}
              style={{padding:"8px 14px",borderRadius:5,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",fontFamily:"DM Sans,sans-serif",fontSize:12,cursor:"pointer"}}>
              ← Prev
            </button>
          )}
          {!isLast && (
            <button onClick={()=>setSection(s=>s+1)}
              style={{padding:"8px 16px",borderRadius:5,border:"none",background:"var(--blue)",color:"#fff",fontFamily:"DM Sans,sans-serif",fontSize:12,fontWeight:500,cursor:"pointer"}}>
              Next →
            </button>
          )}
          {isLast && (
            <button onClick={()=>{ onSave({...data, client_name: clientName}); }}
              style={{padding:"8px 20px",borderRadius:5,border:"none",background:"var(--green2)",color:"#fff",fontFamily:"DM Sans,sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              ✓ Save & Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// FORMS PAGE — Library + Fill + Responses + Schema
// ─────────────────────────────────────────────────────────
function FormsPage({ toast, onNav }) {
  const [activeTab, setActiveTab] = useState("library");
  const [sendModal, setSendModal] = useState(null);
  const [fillForm, setFillForm]   = useState(null); // form being filled by FSA

  const tabs = [
    {id:"library",   label:"📋 Forms Library"},
    {id:"responses", label:"📥 Submitted Responses"},
    {id:"schema",    label:"🗄 Supabase Schema"},
  ];

  // If FSA is filling a form on behalf of client, show inline filler full-width
  if (fillForm) {
    return (
      <InlineFormFiller
        form={fillForm}
        toast={toast}
        onCancel={() => setFillForm(null)}
        onSave={async data => {
          // Fill-on-behalf: create a submission record + token via /api/forms/send,
          // then immediately submit the collected data via /api/forms/submit.
          try {
            const clientName = data.full_name || data.client_name || "";
            const sendRes = await fetch("/api/forms/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ form_id: fillForm.id, channel: "link", client_name: clientName }),
            });
            const sendData = await sendRes.json();
            if (!sendData.success || !sendData.token) {
              toast(sendData.message || sendData.error || "Failed to create submission", sendData.reason === "already_complete" ? "info" : "error");
              return;
            }
            const subRes = await fetch("/api/forms/submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: sendData.token, form_id: fillForm.id, response_data: { ...data, client_name: clientName } }),
            });
            const subData = await subRes.json();
            if (subData.success) toast(`✓ ${fillForm.title} saved (Ref ${subData.ref})`, "success");
            else toast(subData.error || "Failed to save form", "error");
          } catch {
            toast("Network error saving form", "error");
          }
          setFillForm(null);
          setActiveTab("responses");
        }}
      />
    );
  }

  return (
    <>
      <div className="page-title">Client Forms</div>
      <div className="page-sub">
        Fill out forms on behalf of clients · Or send a link for clients to complete themselves ·
        <button className="card-link" style={{marginLeft:8}} onClick={()=>onNav("fna")}>Go to FNA Generator →</button>
      </div>

      <div className="tab-bar">
        {tabs.map(t => <button key={t.id} className={`tab-btn ${activeTab===t.id?"active":""}`} onClick={()=>setActiveTab(t.id)}>{t.label}</button>)}
      </div>

      {/* FORMS LIBRARY */}
      {activeTab === "library" && (
        <div className="forms-grid">
          {FORMS.map(f => (
            <div className="form-card" key={f.id}>
              <div className="form-card-head">
                <div className="form-icon" style={{background:f.bg}}>{f.icon}</div>
                <div>
                  <div className="form-title">{f.title}</div>
                  <div className="form-id">Form #{f.formNum} · {f.fields.length} fields</div>
                </div>
              </div>
              <div className="form-card-body">
                <div className="form-desc">{f.desc}</div>
                <div className="form-meta">
                  {f.tags.map(t => <span key={t} className="fm-tag" style={{background:f.bg,color:f.color,border:`1px solid ${f.color}33`}}>{t}</span>)}
                </div>
                {/* DUAL MODE ACTIONS */}
                <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:10}}>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn-primary" style={{flex:1}} onClick={() => setFillForm(f)}>
                      ✏ Fill on Behalf of Client
                    </button>
                    <button className="btn-secondary" style={{flex:1}} onClick={() => setSendModal(f)}>
                      📤 Send Link to Client
                    </button>
                  </div>
                  <div style={{fontSize:9,display:"flex",justifyContent:"space-between",color:"var(--muted)",fontFamily:"DM Mono,monospace",paddingTop:2}}>
                    <span>You fill it during/after meeting</span>
                    <span>Client fills it themselves</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* RESPONSES */}
      {activeTab === "responses" && <ResponsesViewer toast={toast}/>}

      {/* SCHEMA */}
      {activeTab === "schema" && <SchemaView/>}

      <SendModal form={sendModal} onClose={() => setSendModal(null)} toast={toast}/>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// FNA PAGE — Fill FNA intake yourself OR send to client
// ─────────────────────────────────────────────────────────
function FNAPage({ toast, onNav }) {
  const [mode, setMode] = useState(null); // null | "fill" | "send" | "generate"
  const [fnaCount, setFnaCount] = useState(0);
  const [sendName, setSendName] = useState("");
  const [sendEmail, setSendEmail] = useState("");
  const [sending, setSending] = useState(false);

  const fnaForm = FORMS.find(f => f.id === "financial-needs-analysis");

  const sendFnaLink = async () => {
    if(!sendName){ toast("Enter client name","error"); return; }
    setSending(true);
    try {
      const ch = sendEmail ? "email" : "link";
      const res = await fetch("/api/forms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form_id: "financial-needs-analysis", channel: ch, client_name: sendName, email: sendEmail }),
      });
      const d = await res.json();
      if(d.success) {
        if(ch === "link" && d.link) { navigator.clipboard?.writeText(d.link); toast(`✓ FNA link created & copied for ${sendName}`,"success"); }
        else toast(`✓ FNA intake link sent to ${sendName}`,"success");
        setSendName(""); setSendEmail("");
      } else {
        toast(d.message || d.error || "Failed to send FNA link", d.reason === "already_complete" ? "info" : "error");
      }
    } catch { toast("Network error sending FNA link","error"); }
    finally { setSending(false); }
  };

  useEffect(() => {
    fetch("/api/forms/responses?form_id=financial-needs-analysis&status=complete&limit=100")
      .then(r => r.json())
      .then(d => setFnaCount((d.submissions || []).length))
      .catch(() => setFnaCount(0));
  }, []);

  // Mode: FSA fills FNA intake on behalf of client
  if (mode === "fill") {
    return (
      <InlineFormFiller
        form={fnaForm}
        toast={toast}
        onCancel={() => setMode(null)}
        onSave={async data => {
          // Persist the intake: create a submission + token, then submit the data.
          try {
            const clientName = data.client_name || data.full_name || "";
            const sendRes = await fetch("/api/forms/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ form_id: "financial-needs-analysis", channel: "link", client_name: clientName }),
            });
            const sendData = await sendRes.json();
            if (!sendData.success || !sendData.token) {
              toast(sendData.message || sendData.error || "Failed to create submission", sendData.reason === "already_complete" ? "info" : "error");
              return;
            }
            const subRes = await fetch("/api/forms/submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: sendData.token, form_id: "financial-needs-analysis", response_data: { ...data, client_name: clientName } }),
            });
            const subData = await subRes.json();
            if (subData.success) {
              toast("✓ FNA intake saved", "success");
              setMode("generate");
            } else {
              toast(subData.error || "Failed to save form", "error");
            }
          } catch {
            toast("Network error saving form", "error");
          }
        }}
      />
    );
  }

  // Mode: generate report from existing submission
  if (mode === "generate") {
    return (
      <>
        <div className="page-title">Financial Needs Analysis</div>
        <div className="page-sub">
          <button className="card-link" onClick={()=>setMode(null)}>← Back</button>
        </div>
        <FNAGenerator toast={toast}/>
      </>
    );
  }

  // Default: choice screen
  return (
    <>
      <div className="page-title">Financial Needs Analysis</div>
      <div className="page-sub">
        Create a professional AI-powered FNA report · Fill intake yourself or send to client ·
        <button className="card-link" style={{marginLeft:8}} onClick={()=>onNav("forms")}>← Back to Forms</button>
      </div>

      {/* MODE SELECTOR */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20,maxWidth:800}}>
        {/* Option 1 — Fill yourself */}
        <div style={{background:"var(--card)",border:"2px solid var(--blue-border)",borderRadius:12,padding:24,cursor:"pointer",transition:"all .15s",boxShadow:"var(--shadow)"}}
          onClick={() => setMode("fill")}
          onMouseOver={e=>{e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.boxShadow="var(--shadow2)";}}
          onMouseOut={e=>{e.currentTarget.style.borderColor="var(--blue-border)";e.currentTarget.style.boxShadow="var(--shadow)";}}>
          <div style={{fontSize:32,marginBottom:10}}>✏️</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--navy)",marginBottom:6}}>Fill Intake Yourself</div>
          <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.7,marginBottom:14}}>
            You collect the client's information during or after a meeting and enter it directly. Ideal for in-person appointments or phone intakes.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {["Enter client data directly in the system","Risk tolerance auto-calculated as you fill","Generate FNA report immediately after saving","No client action required"].map((s,i)=>(
              <div key={i} style={{display:"flex",gap:6,alignItems:"flex-start",fontSize:11,color:"var(--text)"}}>
                <span style={{color:"var(--green2)",flexShrink:0}}>✓</span>{s}
              </div>
            ))}
          </div>
          <button className="btn-primary" style={{width:"100%",marginTop:14,padding:10,fontSize:12}}>
            ✏ Fill FNA Intake Now →
          </button>
        </div>

        {/* Option 2 — Send to client */}
        <div style={{background:"var(--card)",border:"2px solid var(--green-border)",borderRadius:12,padding:24,cursor:"pointer",transition:"all .15s",boxShadow:"var(--shadow)"}}
          onMouseOver={e=>{e.currentTarget.style.borderColor="var(--green2)";e.currentTarget.style.boxShadow="var(--shadow2)";}}
          onMouseOut={e=>{e.currentTarget.style.borderColor="var(--green-border)";e.currentTarget.style.boxShadow="var(--shadow)";}}>
          <div style={{fontSize:32,marginBottom:10}}>📤</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--navy)",marginBottom:6}}>Send Link to Client</div>
          <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.7,marginBottom:14}}>
            Client receives a secure link by email or SMS and fills out the intake form themselves. System notifies you when complete and auto-generates the report.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {["Tokenized secure link — expires in 30 days","Client fills out on phone or computer","Auto-sent when appointment booked in Calendly","Responses stored in Supabase automatically"].map((s,i)=>(
              <div key={i} style={{display:"flex",gap:6,alignItems:"flex-start",fontSize:11,color:"var(--text)"}}>
                <span style={{color:"var(--green2)",flexShrink:0}}>✓</span>{s}
              </div>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              <div className="field" style={{marginBottom:0}}>
                <label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:3}}>Client Name</label>
                <input value={sendName} onChange={e=>setSendName(e.target.value)} placeholder="John Smith"
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"DM Sans,sans-serif",outline:"none"}}/>
              </div>
              <div className="field" style={{marginBottom:0}}>
                <label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:3}}>Email (optional — blank = copy link)</label>
                <input value={sendEmail} onChange={e=>setSendEmail(e.target.value)} type="email" placeholder="john@email.com"
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"DM Sans,sans-serif",outline:"none"}}/>
              </div>
            </div>
            <button className="btn-green" style={{width:"100%",padding:10,fontSize:12}} disabled={sending}
              onClick={sendFnaLink}>
              {sending ? "Sending…" : "📤 Send FNA Link →"}
            </button>
          </div>
        </div>
      </div>

      {/* Generate from existing submission */}
      <div style={{background:"var(--card)",border:"1px solid var(--gold-border)",borderRadius:10,padding:20,maxWidth:800}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <div style={{fontSize:22}}>✦</div>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:"var(--navy)"}}>Generate Report from Existing Submission</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Client already submitted their intake form — generate the FNA report now.</div>
          </div>
          <button className="btn-gold" style={{marginLeft:"auto"}} onClick={()=>setMode("generate")}>
            Generate FNA Report →
          </button>
        </div>
        <div style={{fontSize:11,color:"var(--muted)"}}>
          {fnaCount} FNA submission{fnaCount!==1?"s":""} ready to generate
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// 1. CONVERSION CENTER — Dedicated deadline tracker
// ─────────────────────────────────────────────────────────
function ConversionCenter({toast,appData={}}) {
  const liveData = appData.urgentConversions || [];
  const [overrides, setOverrides] = useState({});

  // Merge live data with local status overrides
  const cases = liveData.map(c => ({
    id: c.policy_id,
    client: `${c.customers?.first_name||""} ${c.customers?.last_name||""}`.trim()||"Unknown",
    agency: c.customers?.agencies?.name||"—",
    policyNum: c.policy_number||"—",
    face: c.face_amount||0,
    premium: c.annual_premium||0,
    deadline: c.conversion_deadline||"—",
    days: c.days_to_deadline??999,
    status: overrides[c.policy_id]?.status||"Not Started",
    contacted: overrides[c.policy_id]?.contacted||false,
    apptBooked: overrides[c.policy_id]?.apptBooked||false,
    ghlStage: c.ghl?.stage||null,
    ghlPos: c.ghl?.stage_position||null,
    ghlPipeline: c.ghl?.pipeline||null,
    inGhl: !!c.ghl?.in_ghl,
  }));

  const displayCases = cases;

  const urgencyColor = d => d <= 30 ? "var(--red)" : d <= 90 ? "var(--orange)" : "var(--green2)";
  const urgencyBg   = d => d <= 30 ? "var(--red-bg)" : d <= 90 ? "var(--orange-bg)" : "var(--green-bg)";
  const urgencyBdr  = d => d <= 30 ? "var(--red-border)" : d <= 90 ? "var(--orange-border)" : "var(--green-border)";

  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? displayCases :
    filter === "30" ? displayCases.filter(c=>c.days<=30) :
    filter === "90" ? displayCases.filter(c=>c.days>30&&c.days<=90) :
    displayCases.filter(c=>c.days>90);

  const cycle = (id) => {
    const seq = ["Not Started","Needs Contact","SMS Sent","Appt Scheduled","Reviewed","Complete"];
    setOverrides(prev => {
      const cur = prev[id] || {};
      const idx = seq.indexOf(cur.status||"Not Started");
      const next = seq[(idx+1)%seq.length];
      toast(`${displayCases.find(c=>c.id===id)?.client||"Case"} → ${next}`,"success");
      return {...prev, [id]:{...cur, status:next, contacted:idx>=0, apptBooked:idx>=3}};
    });
  };

  const total = displayCases.length;
  const urgent = displayCases.filter(c=>c.days<=30).length;
  const booked = displayCases.filter(c=>c.apptBooked).length;
  const fmtCur = n=>"$"+Number(n||0).toLocaleString("en-US");

  return (<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div><div className="page-title" style={{marginBottom:2}}>Conversion Center</div>
        <div style={{fontSize:12,color:"var(--muted)"}}>Track every term conversion deadline · Color-coded by urgency · One-click status updates</div>
      </div>
      <button className="import-btn" onClick={()=>toast("Importing from APEX Conversion Report...","success")}>↓ Import from APEX</button>
    </div>

    {/* SUMMARY STRIP */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
      {[
        {label:"Total Conversions",val:total,color:"var(--text)",bg:"var(--card)"},
        {label:"Expiring < 30 Days",val:urgent,color:"var(--red)",bg:"var(--red-bg)",bdr:"var(--red-border)"},
        {label:"Appointments Booked",val:booked,color:"var(--green2)",bg:"var(--green-bg)",bdr:"var(--green-border)"},
        {label:"Total Face Amount",val:"$"+displayCases.reduce((s,c)=>s+c.face,0).toLocaleString("en-US"),color:"#2b6cb0",bg:"var(--blue-bg)",bdr:"var(--blue-border)"},
      ].map((s,i)=>(
        <div key={i} style={{background:s.bg,border:`1px solid ${s.bdr||"var(--border)"}`,borderRadius:9,padding:"14px 16px",boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:10,color:"var(--muted)",marginBottom:5}}>{s.label}</div>
          <div style={{fontSize:24,fontWeight:700,color:s.color,lineHeight:1}}>{s.val}</div>
        </div>
      ))}
    </div>

    {/* FILTERS */}
    <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      {[["all","All"],["30","🔴 < 30 Days"],["90","🟠 30–90 Days"],["90+","🟢 > 90 Days"]].map(([v,l])=>(
        <button key={v} className={`opp-filter${filter===v?" active":""}`} onClick={()=>setFilter(v)}>{l}</button>
      ))}
      <span style={{marginLeft:"auto",fontSize:10,color:"var(--muted)"}}>Showing {filtered.length} of {total}</span>
      <button className="btn-secondary" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>toast("Exporting conversions CSV...","success")}>Export CSV</button>
    </div>

    {/* TABLE */}
    {displayCases.length===0 ? (
      <div className="empty-state">
        <div className="empty-state-icon">⏰</div>
        <div className="empty-state-title">No conversions in the pipeline yet</div>
        <div className="empty-state-sub">Import a term-conversion report from APEX to start tracking deadlines.</div>
      </div>
    ) : (
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"auto",boxShadow:"var(--shadow)"}}>
      <table className="cases-table" style={{minWidth:860}}>
        <thead><tr>
          <th>Client</th><th>Agency</th><th>Policy #</th>
          <th style={{textAlign:"right"}}>Face Amount</th>
          <th style={{textAlign:"right"}}>Premium/mo</th>
          <th>Deadline</th>
          <th style={{textAlign:"center"}}>Days Left</th>
          <th>Contacted</th><th>Appt</th>
          <th>Status</th><th>Action</th>
        </tr></thead>
        <tbody>
          {filtered.map(c=>(
            <tr key={c.id}>
              <td style={{fontWeight:600}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  {c.client}
                  <GhlBadge stage={c.ghlStage} pos={c.ghlPos} pipeline={c.ghlPipeline} inGhl={c.inGhl}/>
                </div>
              </td>
              <td style={{fontSize:10,color:"var(--muted)"}}>{c.agency}</td>
              <td><span className="td-mono" style={{fontSize:9,color:"var(--dim)"}}>{c.policyNum}</span></td>
              <td className="td-mono" style={{textAlign:"right",fontWeight:600}}>{fmtCur(c.face)}</td>
              <td className="td-mono" style={{textAlign:"right",color:"var(--muted)"}}>${c.premium}</td>
              <td className="td-mono" style={{fontSize:10,color:"var(--muted)"}}>{c.deadline}</td>
              <td style={{textAlign:"center"}}>
                <span style={{background:urgencyBg(c.days),color:urgencyColor(c.days),border:`1px solid ${urgencyBdr(c.days)}`,borderRadius:5,padding:"2px 9px",fontFamily:"DM Mono,monospace",fontSize:10,fontWeight:700}}>
                  {c.days}d
                </span>
              </td>
              <td style={{textAlign:"center"}}><span style={{fontSize:14}}>{c.contacted?"✅":"⭕"}</span></td>
              <td style={{textAlign:"center"}}><span style={{fontSize:14}}>{c.apptBooked?"📅":"—"}</span></td>
              <td><span className={`sp ${c.apptBooked?"sp-confirmed":c.contacted?"sp-submitted":"sp-pending"}`}>{c.status}</span></td>
              <td>
                <div style={{display:"flex",gap:4}}>
                  <button style={{fontSize:9,padding:"3px 8px",borderRadius:3,border:"none",background:"#2b6cb0",color:"#fff",cursor:"pointer"}} onClick={()=>cycle(c.id)}>→ Next</button>
                  <button style={{fontSize:9,padding:"3px 6px",borderRadius:3,border:"1px solid var(--green-border)",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer"}} onClick={()=>toast(`Calling ${c.client}`,"success")}>📞</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    )}
  </>);
}

// ─────────────────────────────────────────────────────────
// 2. OPRA CENTER — Transfer tracking
// ─────────────────────────────────────────────────────────
function OPRACenter({toast,appData={}}) {
  const [liveData, setLiveData] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    // Fetch the full list (no contacted filter) so marking a row "Contacted"
    // doesn't make it vanish; sort uncontacted-first client-side.
    fetch("/api/opra?limit=100")
      .then(r => { if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(d => {
        setLiveData(d.cases || []);
        setCounts(d.counts || null);
        setLoading(false);
      })
      .catch(e => { setError(e.message||"Failed to load"); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const cases = liveData.map(c => ({
      id: c.opra_id,
      isLive: true,
      client: `${c.customers?.first_name||""} ${c.customers?.last_name||""}`.trim()||"Unknown",
      agency: c.customers?.agencies?.name||"—",
      transferDate: c.transfer_date,
      premium: c.annual_premium||0,
      contacted: c.contacted,
      apptScheduled: c.appt_scheduled,
      reviewDone: c.review_complete,
      transferred: c.transferred,
      status: c.status,
      ghlStage: c.ghl?.stage||null,
      ghlPos: c.ghl?.stage_position||null,
      ghlPipeline: c.ghl?.pipeline||null,
      inGhl: !!c.ghl?.in_ghl,
    }))
    .sort((a,b) => (a.contacted===b.contacted ? 0 : a.contacted ? 1 : -1));

  // Persist a status change to the OPRA case, then refresh from the server
  const patchCase = async (c, body, label) => {
    if (!c.isLive) { toast("Demo row — connect data to persist","info"); return; }
    try {
      const res = await fetch("/api/opra", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opra_id: c.id, ...body }),
      });
      const d = await res.json();
      if (d.case) { toast(`${c.client} — ${label}`,"success"); refresh(); }
      else toast(d.error || "Update failed","error");
    } catch { toast("Network error","error"); }
  };

  const cycle = (c, field) => {
    if (field==="contacted") patchCase(c, { contacted: !c.contacted, contacted_at: new Date().toISOString() }, "marked contacted");
    else if (field==="apptScheduled") patchCase(c, { appt_scheduled: !c.apptScheduled }, "appointment updated");
    else if (field==="reviewDone") patchCase(c, { review_complete: !c.reviewDone }, "review updated");
  };

  const ready = cases.filter(c=>!c.reviewDone).length;
  const booked = counts ? counts.appt_scheduled : cases.filter(c=>c.apptScheduled).length;
  const notContacted = counts ? counts.not_contacted : cases.filter(c=>!c.contacted).length;
  const totalCases = counts ? counts.total : cases.length;

  return (<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div><div className="page-title" style={{marginBottom:2}}>OPRA Transfer Center</div>
        <div style={{fontSize:12,color:"var(--muted)"}}>One-policy customers eligible for OPRA transfer · Track contact, appointment, review status</div>
      </div>
      <button className="import-btn" onClick={()=>toast("Importing from APEX OPRA Report...","success")}>↓ Import from APEX</button>
    </div>

    {/* SUMMARY */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
      {[
        {label:"Total OPRA Cases",val:totalCases,color:"var(--text)",bg:"var(--card)"},
        {label:"Not Contacted",val:notContacted,color:"var(--red)",bg:"var(--red-bg)",bdr:"var(--red-border)"},
        {label:"Appointments Booked",val:booked,color:"#2b6cb0",bg:"var(--blue-bg)",bdr:"var(--blue-border)"},
        {label:"Ready to Close",val:ready,color:"var(--orange)",bg:"var(--orange-bg)",bdr:"var(--orange-border)"},
      ].map((s,i)=>(
        <div key={i} style={{background:s.bg,border:`1px solid ${s.bdr||"var(--border)"}`,borderRadius:9,padding:"14px 16px",boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:10,color:"var(--muted)",marginBottom:5}}>{s.label}</div>
          <div style={{fontSize:24,fontWeight:700,color:s.color,lineHeight:1}}>{s.val}</div>
        </div>
      ))}
    </div>

    {error && <div className="error-banner"><span>⚠ Couldn't load OPRA cases ({error}).</span><button onClick={refresh}>Retry</button></div>}
    {loading && <div style={{fontSize:12,color:"var(--muted)",marginBottom:10}}>Loading OPRA cases…</div>}

    {!loading && !error && cases.length===0 && (
      <div className="empty-state">
        <div className="empty-state-icon">🔄</div>
        <div className="empty-state-title">No OPRA cases yet</div>
        <div className="empty-state-sub">Import an OPRA list from APEX to start tracking transfers.</div>
      </div>
    )}

    {/* TABLE */}
    {cases.length>0 && <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"auto",boxShadow:"var(--shadow)"}}>
      <table className="cases-table" style={{minWidth:760}}>
        <thead><tr>
          <th>Customer</th><th>Agency</th><th>Transfer Date</th>
          <th style={{textAlign:"right"}}>Annual Premium</th>
          <th style={{textAlign:"center"}}>Contacted</th>
          <th style={{textAlign:"center"}}>Appt Scheduled</th>
          <th style={{textAlign:"center"}}>Review Done</th>
          <th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
          {cases.map(c=>(
            <tr key={c.id}>
              <td style={{fontWeight:600}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  {c.client}
                  <GhlBadge stage={c.ghlStage} pos={c.ghlPos} pipeline={c.ghlPipeline} inGhl={c.inGhl}/>
                </div>
              </td>
              <td style={{fontSize:10,color:"var(--muted)"}}>{c.agency}</td>
              <td className="td-mono" style={{fontSize:10,color:"var(--muted)"}}>{c.transferDate}</td>
              <td className="td-mono" style={{textAlign:"right",fontWeight:600}}>${c.premium.toLocaleString()}</td>
              <td style={{textAlign:"center"}}>
                <button style={{fontSize:14,background:"none",border:"none",cursor:"pointer"}} onClick={()=>cycle(c,"contacted")} title="Mark contacted">
                  {c.contacted?"✅":"⭕"}
                </button>
              </td>
              <td style={{textAlign:"center"}}>
                <button style={{fontSize:14,background:"none",border:"none",cursor:"pointer"}} onClick={()=>cycle(c,"apptScheduled")} title="Toggle appointment">
                  {c.apptScheduled?"📅":"—"}
                </button>
              </td>
              <td style={{textAlign:"center"}}>
                <button style={{fontSize:14,background:"none",border:"none",cursor:"pointer"}} onClick={()=>cycle(c,"reviewDone")} title="Toggle review done">
                  {c.reviewDone?"✅":"⭕"}
                </button>
              </td>
              <td><span className={`sp ${c.transferred?"sp-confirmed":c.reviewDone?"sp-confirmed":c.apptScheduled?"sp-submitted":c.contacted?"sp-pending":"sp-flagged"}`}>{c.transferred?"Transferred":c.status}</span></td>
              <td>
                <div style={{display:"flex",gap:4}}>
                  <button style={{fontSize:9,padding:"3px 8px",borderRadius:3,border:"none",background:"#2b6cb0",color:"#fff",cursor:"pointer"}} onClick={()=>patchCase(c,{contacted:true,contacted_at:new Date().toISOString()},"marked contacted")}>Mark Contacted</button>
                  <button style={{fontSize:9,padding:"3px 8px",borderRadius:3,border:"1px solid var(--blue-border)",background:"var(--blue-bg)",color:"#2b6cb0",cursor:"pointer"}} onClick={()=>patchCase(c,{appt_scheduled:true},"appt scheduled")}>Appt Scheduled</button>
                  <button style={{fontSize:9,padding:"3px 8px",borderRadius:3,border:"1px solid var(--green-border)",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer"}} onClick={()=>patchCase(c,{transferred:true,transferred_date:new Date().toISOString().split("T")[0],status:"transferred"},"transferred")}>Transferred</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>}

    <div style={{marginTop:12,padding:"10px 14px",background:"var(--blue-bg)",border:"1px solid var(--blue-border)",borderRadius:7,fontSize:11,color:"var(--blue)"}}>
      💡 <strong>OPRA tip:</strong> Click any ✅/⭕ or 📅 directly in the table to toggle status instantly. Import from APEX exports the full current OPRA list.
    </div>
  </>);
}

// ─────────────────────────────────────────────────────────
// 3. OPPORTUNITY DASHBOARD — Priority-scored, all types
// ─────────────────────────────────────────────────────────
function OpportunityDashboard({toast,appData={}}) {
  const [expanded, setExpanded] = useState(null);
  const [opps, setOpps] = useState([]);
  const [pipelineCounts, setPipelineCounts] = useState({});
  const [pipeFilter, setPipeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const actionColor = {CONV:"var(--orange)",OPRA:"var(--red)",LIFE:"var(--blue)",RETIRE:"var(--purple)",BIZ:"#7b2d8b"};
  const actionLabel = {CONV:"Conversion",OPRA:"OPRA",LIFE:"Life Review",RETIRE:"Retirement",BIZ:"Business Owner"};
  const actionMap2 = {conversions:"CONV",opra:"OPRA",life:"LIFE",retirement:"RETIRE",business:"BIZ"};

  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/scores?limit=100${pipeFilter!=="all"?`&pipeline=${pipeFilter}`:""}`)
      .then(r => { if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(d => {
        setOpps(d.opportunities || []);
        setPipelineCounts(d.pipeline_counts || {});
        setLoading(false);
      })
      .catch(e => { setError(e.message||"Failed to load"); setLoading(false); });
  }, [pipeFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  // Map live scored customers to display format
  const priorities = opps.map(o => {
    const name = `${o.customers?.first_name||""} ${o.customers?.last_name||""}`.trim()||"Unknown";
    const pipeline = o.primary_pipeline || "general";
    const action = actionMap2[pipeline] || "LIFE";
    const score = o.priority_score || 0;
    return {
      name,
      pri: score >= 75 ? "HIGH" : score >= 50 ? "MED" : "LOW",
      reason: `${actionLabel[action]||pipeline} opportunity`,
      face: o.customers?.age ? `Age ${o.customers.age}` : "—",
      policy: pipeline,
      agency: o.customers?.agencies?.name || "—",
      phone: o.customers?.phone || "",
      email: o.customers?.email || "",
      score,
      action,
      calls: 0, sms: 0,
      booked: false,
      biz: pipeline === "business",
      formDone: false,
      ghlStage: o.ghl?.stage || null,
      ghlPipeline: o.ghl?.pipeline || null,
      ghlPos: o.ghl?.stage_position || null,
      inGhl: !!o.ghl?.in_ghl,
      customerId: o.customers?.customer_id || null,
    };
  });

  const displayPriorities = priorities;

  const high = displayPriorities.filter(p=>p.pri==="HIGH"||p.biz);
  const med  = displayPriorities.filter(p=>p.pri==="MED"&&!p.biz);
  const low  = displayPriorities.filter(p=>p.pri==="LOW"&&!p.biz);

  const pipeButtons = [
    {id:"all",label:"All"},
    {id:"conversions",label:"Conversions"},
    {id:"opra",label:"OPRA"},
    {id:"life",label:"Life"},
    {id:"retirement",label:"Retirement"},
    {id:"business",label:"Business"},
  ];

  const OppGroup = ({title, items, color, icon}) => (
    <div style={{marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingBottom:8,borderBottom:`2px solid ${color}44`}}>
        <span style={{fontSize:16}}>{icon}</span>
        <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color,textTransform:"uppercase",letterSpacing:".08em"}}>{title}</span>
        <span style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--muted)",marginLeft:4}}>{items.length} opportunities</span>
      </div>
      {items.map((p,i)=>(
        <div key={i} style={{background:"var(--card)",border:`1px solid ${expanded===p.name?"#bee3f8":"var(--border)"}`,borderRadius:9,padding:"14px 16px",marginBottom:8,boxShadow:"var(--shadow)",cursor:"pointer",transition:"all .15s"}}
          onClick={()=>setExpanded(expanded===p.name?null:p.name)}>
          <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
            <div style={{width:40,height:40,borderRadius:"50%",background:p.biz?"linear-gradient(135deg,#7b2d8b,#553c9a)":"linear-gradient(135deg,#4299e1,#2b6cb0)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff",flexShrink:0}}>
              {ini(p.name)}
            </div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{fontSize:13,fontWeight:600}}>{p.name}</span>
                <span style={{fontSize:9,fontFamily:"DM Mono,monospace",padding:"2px 7px",borderRadius:3,background:p.biz?"#f3e8ff":"var(--blue-bg)",color:p.biz?"#7b2d8b":actionColor[p.action],border:`1px solid ${p.biz?"#d6b4fe":"var(--blue-border)"}`}}>
                  {actionLabel[p.action]}
                </span>
                {p.formDone && <span style={{fontSize:9,background:"var(--green-bg)",color:"var(--green)",border:"1px solid var(--green-border)",borderRadius:3,padding:"2px 5px",fontFamily:"DM Mono,monospace"}}>Forms ✓</span>}
                {p.ghlStage && <span title={p.ghlPipeline?`GHL · ${p.ghlPipeline}`:"GoHighLevel pipeline stage"} style={{fontSize:9,background:"#f0e9ff",color:"#6b46c1",border:"1px solid #d6bcfa",borderRadius:3,padding:"2px 6px",fontFamily:"DM Mono,monospace"}}>◆ {p.ghlPos?`${p.ghlPos}. `:""}{p.ghlStage}</span>}
                {!p.ghlStage && p.inGhl && <span title="Synced to GoHighLevel (no opportunity stage yet)" style={{fontSize:9,background:"var(--card)",color:"var(--muted)",border:"1px dashed var(--border)",borderRadius:3,padding:"2px 6px",fontFamily:"DM Mono,monospace"}}>◇ In GHL</span>}
              </div>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:4}}>{p.reason}</div>
              <div style={{fontSize:10,color:"var(--dim)",fontFamily:"DM Mono,monospace"}}>◎ {p.face} · {p.policy} · {p.agency}</div>
              {(p.phone||p.email) && <div style={{fontSize:10,color:"var(--dim)",fontFamily:"DM Mono,monospace",marginTop:2}}>{[p.phone,p.email].filter(Boolean).join(" · ")}</div>}
            </div>
            <div style={{textAlign:"center",flexShrink:0}}>
              <div style={{fontSize:22,fontWeight:700,color:"#2b6cb0",lineHeight:1}}>{p.score}</div>
              <div style={{fontSize:8,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".06em",fontFamily:"DM Mono,monospace"}}>Score</div>
            </div>
          </div>
          {/* Expanded action row */}
          {expanded===p.name && (
            <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid var(--border)",display:"flex",gap:8,flexWrap:"wrap"}}>
              <button className="btn-primary" style={{fontSize:10,padding:"5px 12px"}} onClick={e=>{e.stopPropagation();toast(`Calling ${p.name}`,"success");}}>📞 Call Now</button>
              <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={e=>{e.stopPropagation();toast(`SMS sent to ${p.name}`,"success");}}>💬 Send SMS</button>
              <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={e=>{e.stopPropagation();toast(`Booking appointment for ${p.name}`,"info");}}>📅 Book Appt</button>
              <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={e=>{e.stopPropagation();toast(`Opening forms for ${p.name}`,"info");}}>📋 Send Forms</button>
              <button style={{fontSize:10,padding:"5px 12px",borderRadius:5,border:"1px solid #d6bcfa",background:"#f0e9ff",color:"#6b46c1",cursor:"pointer"}} disabled={!p.customerId}
                onClick={async e=>{e.stopPropagation();
                  if(!p.customerId){toast("No linked customer to sync","error");return;}
                  toast(`Syncing ${p.name} to GHL…`,"info");
                  const r=await syncToGhl({customer_id:p.customerId, pipeline:"prospect_client", stage:p.inGhl?(p.ghlPos||1):1});
                  if(r.ok){toast(`${p.name} synced to GHL`,"success");refresh();}
                  else toast(r.data?.error||`GHL sync failed (${r.status})`,"error");
                }}>◆ {p.inGhl?"Re-sync GHL":"Sync to GHL"}</button>
              {p.action==="RETIRE"||p.action==="LIFE" ?
                <button style={{fontSize:10,padding:"5px 12px",borderRadius:5,border:"none",background:"#b7791f",color:"#fff",cursor:"pointer"}} onClick={e=>{e.stopPropagation();toast(`Generating FNA for ${p.name}`,"success");}}>✦ Generate FNA</button>:null}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div><div className="page-title" style={{marginBottom:2}}>Opportunity Dashboard</div>
        <div style={{fontSize:12,color:"var(--muted)"}}>Every revenue opportunity ranked by priority · Click any card to take action</div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={refresh}>↻ Refresh Scores</button>
        <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={()=>toast("Exporting opportunities...","success")}>Export CSV</button>
      </div>
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
      {pipeButtons.map(b=>(
        <button key={b.id} onClick={()=>setPipeFilter(b.id)}
          style={{fontSize:10,padding:"5px 12px",borderRadius:5,cursor:"pointer",border:`1px solid ${pipeFilter===b.id?"#2b6cb0":"var(--border)"}`,background:pipeFilter===b.id?"var(--blue-bg)":"var(--card)",color:pipeFilter===b.id?"#2b6cb0":"var(--text)",fontWeight:pipeFilter===b.id?700:500,fontFamily:"DM Mono,monospace"}}>
          {b.label}{b.id!=="all"&&pipelineCounts[b.id]!=null?` (${pipelineCounts[b.id]})`:""}
        </button>
      ))}
    </div>
    {error && <div className="error-banner"><span>⚠ Couldn't load opportunities ({error}).</span><button onClick={refresh}>Retry</button></div>}
    {loading && <div style={{fontSize:12,color:"var(--muted)",marginBottom:12}}>Loading opportunities…</div>}
    {!loading && !error && displayPriorities.length===0 && (
      <div className="empty-state">
        <div className="empty-state-icon">🎯</div>
        <div className="empty-state-title">No opportunities yet</div>
        <div className="empty-state-sub">Nothing scored for this pipeline. Run nightly scoring or add customers.</div>
      </div>
    )}
    <OppGroup title="High Priority" items={high} color="var(--red)" icon="🔥"/>
    <OppGroup title="Medium Priority" items={med} color="var(--orange)" icon="⚡"/>
    <OppGroup title="Low Priority / Follow-up" items={low} color="var(--blue)" icon="📌"/>
  </>);
}

// ─────────────────────────────────────────────────────────
// 4. AI AGENT CONTROL CENTER — Full metrics + scripts
// ─────────────────────────────────────────────────────────
function AIControlCenter({toast}) {
  const agents = [
    {name:"Receptionist AI",status:"online",icon:"📞",role:"Handles all inbound calls. Qualifies callers, answers FAQs, schedules appointments. Active 24/7 on toll-free number.",
      stats:[{l:"Calls Answered",v:12},{l:"Appointments Booked",v:3},{l:"Avg Handle Time",v:"2m 14s"},{l:"Call Transfers",v:0},{l:"Response Rate",v:"98%"},{l:"Est. Monthly Cost",v:"$0*"}],
      script:"When someone calls, I say: 'Thank you for calling Markist at Farmers Insurance. I'm an AI assistant. How can I help you today?' I qualify the caller, answer basic FAQs, and book appointments for Markist.",
      kb:["Office hours: Mon–Fri 8AM–6PM CT","Markist is a licensed Farmers FSA","Can schedule Life, Retirement, OPRA, and Conversion reviews","Does NOT discuss specific rates or product recommendations"]},
    {name:"Appointment Setter AI",status:"running",icon:"🗓",role:"Outbound calls to OPRA customers, referrals, and new opportunities. Goal: book appointments. Calls during 9AM–9PM CT.",
      stats:[{l:"Calls Made",v:41},{l:"Appointments Booked",v:2},{l:"Voicemails Left",v:8},{l:"Contact Rate",v:"29%"},{l:"Booking Rate",v:"17%"},{l:"Est. Monthly Cost",v:"$0*"}],
      script:"Hi, this is an AI assistant calling on behalf of Markist, a licensed Farmers Financial Solutions agent. I'm reaching out because you may be eligible for a complimentary financial review. Would you be open to a brief 30-minute appointment with Markist?",
      kb:["Only calls between 9AM–9PM client's local time","Identifies as AI per TRAIGA requirement","Complies with Texas SB 140 opt-out rules","Maximum 3 contact attempts per prospect"]},
    {name:"Conversion AI",status:"running",icon:"⏰",role:"Dedicated outbound for term conversion opportunities. Contacts policyholders approaching conversion deadlines. Priority: book before expiration.",
      stats:[{l:"Conv. Calls Made",v:17},{l:"Appointments Booked",v:1},{l:"Urgency Messages Sent",v:5},{l:"Contact Rate",v:"35%"},{l:"Booking Rate",v:"12%"},{l:"Est. Monthly Cost",v:"$0*"}],
      script:"Hi [Name], this is an AI assistant calling on behalf of Markist, your Farmers agent. I'm reaching out about your term life insurance policy. Your conversion window is approaching and Markist would like to review your options before it expires. Can I schedule a brief call?",
      kb:["Prioritizes cases with < 60 days to deadline","Escalates < 30 day cases to Markist for personal call","Does NOT discuss premium amounts or product details","Complies with Farmers agent agreement on customer contact"]},
    {name:"Follow-Up AI",status:"running",icon:"💬",role:"SMS and email follow-up for no-shows, missed calls, and unresponsive prospects. Keeps pipeline warm automatically.",
      stats:[{l:"Texts Sent",v:89},{l:"Responses Received",v:14},{l:"Appointments Re-booked",v:4},{l:"Opt-outs",v:1},{l:"Response Rate",v:"16%"},{l:"Est. Monthly Cost",v:"$0*"}],
      script:"Hi [Name], this is Markist's assistant following up from your recent conversation. Markist has a few available times this week for your financial review — would [Day] at [Time] work for you? Reply STOP to opt out.",
      kb:["STOP opt-out handling: immediate removal from all sequences","Maximum 2 follow-up attempts after no-show","Sends no messages after 9PM local time","Links to calendar booking page in every message"]},
  ];

  const [expanded, setExpanded] = useState(null);

  return (<>
    <div className="page-title">AI Agent Control Center</div>
    <div style={{fontSize:12,color:"var(--muted)",marginBottom:12}}>
      All 4 AI agents powered by Retell AI · Calendly handles booking · Pay-per-minute voice, pay-per-message SMS — no platform fee · Compliant with TCPA, Texas SB 140, TRAIGA
    </div>
    <div className="error-banner" style={{background:"var(--orange-bg)",border:"1px solid var(--orange-border)",color:"var(--orange)"}}>
      <span>⚠ Sample metrics — the per-agent counts below are illustrative placeholders. Connect Retell/Twilio to show live activity.</span>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
      {agents.map((a,i)=>(
        <div key={i} style={{background:"var(--card)",border:`1px solid ${expanded===i?"#bee3f8":"var(--border)"}`,borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
          {/* Head */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:"1px solid var(--border)",background:"var(--bg)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>{a.icon}</span>
              <div>
                <div style={{fontSize:13,fontWeight:600}}>{a.name}</div>
                <div style={{fontSize:10,color:"var(--muted)",marginTop:1}}>{a.role}</div>
              </div>
            </div>
            <div className={`asb ${a.status}`}><div className="asb-dot"/>{a.status==="online"?"Online":"Running"}</div>
          </div>
          {/* Stats grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:1,background:"var(--border)"}}>
            {a.stats.map((s,j)=>(
              <div key={j} style={{background:"var(--card)",padding:"11px 12px",textAlign:"center"}}>
                <div style={{fontSize:18,fontWeight:700,color:"var(--text)",lineHeight:1}}>{s.v}</div>
                <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>
          {/* Script expand */}
          {expanded===i && (
            <div style={{padding:"14px 16px",borderTop:"1px solid var(--border)"}}>
              <div style={{fontSize:10,fontFamily:"DM Mono,monospace",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Opening Script</div>
              <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px",fontSize:11,color:"var(--text)",lineHeight:1.7,fontStyle:"italic",marginBottom:10}}>
                "{a.script}"
              </div>
              <div style={{fontSize:10,fontFamily:"DM Mono,monospace",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Knowledge Base Rules</div>
              {a.kb.map((r,k)=>(
                <div key={k} style={{display:"flex",gap:6,padding:"4px 0",borderBottom:"1px solid var(--border)",fontSize:11}}>
                  <span style={{color:"var(--green2)",flexShrink:0}}>✓</span><span style={{color:"var(--text)"}}>{r}</span>
                </div>
              ))}
            </div>
          )}
          {/* Footer */}
          <div style={{padding:"10px 14px",display:"flex",gap:6,flexWrap:"wrap",borderTop:"1px solid var(--border)"}}>
            <button className="a-btn" onClick={()=>toast(`${a.name} paused`,"info")}>Pause</button>
            <button className="a-btn" onClick={()=>toast(`${a.name} activity log`,"info")}>View Log</button>
            <button className="a-btn" onClick={()=>setExpanded(expanded===i?null:i)}>{expanded===i?"Hide Script":"View Script"}</button>
            <button className="a-btn pri" style={{flexBasis:"100%",marginTop:4}} onClick={()=>toast(`${a.name} triggered`,"success")}>▶ Run Now</button>
          </div>
        </div>
      ))}
    </div>
  </>);
}

// ─────────────────────────────────────────────────────────
// 6. DAILY BRIEFING — Full standalone page
// ─────────────────────────────────────────────────────────
function DailyBriefing({onNav, toast, appData={}}) {
  const { counts={}, urgentConversions=[], topOpportunities=[], gdc={}, pendingForms=[], briefing=null, loading=false } = appData;
  const [emailing, setEmailing] = useState(false);

  const expectedGDC = (gdc.pipeline||0) / 30; // rough daily estimate
  const fmtK1 = n => "$"+Math.round((n||0)/1000)+"k";

  const emailBriefing = async () => {
    setEmailing(true);
    try {
      const res = await fetch("/api/briefing/send", { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" });
      const d = await res.json().catch(()=>({}));
      if (!res.ok) toast(d.error || `Could not send (HTTP ${res.status})`, "error");
      else toast(`Briefing emailed to ${d.to}`, "success");
    } catch { toast("Network error sending briefing", "error"); }
    finally { setEmailing(false); }
  };

  return (<>
    <div style={{marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, flexWrap:"wrap"}}>
      <div>
        <div style={{fontSize:11,color:"var(--muted)",fontFamily:"DM Mono,monospace",letterSpacing:".08em",textTransform:"uppercase",marginBottom:4}}>Daily Briefing · {today}</div>
        <div style={{fontSize:28,fontWeight:700,color:"var(--navy)",marginBottom:4}}>Good Morning, Markist 👋</div>
        <div style={{fontSize:13,color:"var(--muted)"}}>Here's everything you need for today — your priorities, appointments, pipeline, and AI activity.</div>
      </div>
      <button className="btn-secondary" disabled={emailing} style={{fontSize:11, padding:"8px 14px", whiteSpace:"nowrap", opacity:emailing?.6:1}} onClick={emailBriefing} title="AI-writes today's briefing and emails it to you">
        {emailing ? "Sending…" : "✉ Email me this briefing"}
      </button>
    </div>

    {/* TOP METRICS */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
      {[
        {l:"Pending Forms",v:counts.pending_forms||0,c:"#2b6cb0",bg:"var(--blue-bg)",bdr:"var(--blue-border)",icon:"📋",nav:"forms"},
        {l:"High-Priority Opps",v:topOpportunities.filter(o=>(o.priority_score||0)>=75).length,c:"var(--red)",bg:"var(--red-bg)",bdr:"var(--red-border)",icon:"🔥",nav:"opps"},
        {l:"Urgent Conversions",v:counts.urgent_conversions||0,c:"var(--orange)",bg:"var(--orange-bg)",bdr:"var(--orange-border)",icon:"⏰",nav:"conv"},
        {l:"Est. Daily Pipeline",v:"$"+(expectedGDC/1000).toFixed(0)+"k",c:"var(--green2)",bg:"var(--green-bg)",bdr:"var(--green-border)",icon:"💰",nav:"gdc"},
      ].map((s,i)=>(
        <div key={i} style={{background:s.bg,border:`1px solid ${s.bdr}`,borderRadius:10,padding:"16px",boxShadow:"var(--shadow)",cursor:"pointer",transition:"all .15s"}}
          onClick={()=>onNav(s.nav)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:10,color:"var(--muted)",marginBottom:5}}>{s.l}</div>
              <div style={{fontSize:30,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
            </div>
            <span style={{fontSize:24}}>{s.icon}</span>
          </div>
          <div style={{fontSize:9,color:s.c,marginTop:6,fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".06em"}}>Tap to view →</div>
        </div>
      ))}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr",gap:16}}>
      {/* PRIORITY ACTIONS */}
      <div>
        <div style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>
          Top Opportunities {loading && <span style={{color:"#4299e1"}}>· Loading…</span>}
        </div>
        {topOpportunities.slice(0,6).map((o,i)=>{
          const name = `${o.customers?.first_name||""} ${o.customers?.last_name||""}`.trim()||"Unknown";
          const reason = `${actionLabel[{conversions:"CONV",opra:"OPRA",life:"LIFE",retirement:"RETIRE",business:"BIZ"}[o.primary_pipeline]||"LIFE"]||o.primary_pipeline} opportunity`;
          return(
            <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,marginBottom:8,boxShadow:"var(--shadow)",cursor:"pointer"}}
              onClick={()=>{onNav("opps");toast(`Opening ${name}`,"info");}}>
              <div style={{width:28,height:28,borderRadius:"50%",background:["#e53e3e","#553c9a","#dd6b20","#2b6cb0","#38a169","#0a5060"][i%6],display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0}}>
                {i+1}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:"var(--text)"}}>{name}</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:1}}>{reason} · {o.customers?.agencies?.name||"—"}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:18,fontWeight:700,color:"#2b6cb0"}}>{o.priority_score||0}</div>
                <div style={{fontSize:8,color:"var(--muted)",fontFamily:"DM Mono,monospace",textTransform:"uppercase"}}>Score</div>
              </div>
            </div>
          );
        })}
        {!loading && topOpportunities.length===0 && (
          <div className="empty-state" style={{padding:"32px 20px"}}>
            <div className="empty-state-icon">🎯</div>
            <div className="empty-state-title">No scored opportunities yet</div>
            <div className="empty-state-sub">Run nightly scoring or add customers to populate today's priorities.</div>
          </div>
        )}
        <button className="btn-primary" style={{width:"100%",marginTop:4,padding:9}} onClick={()=>onNav("opps")}>View All Opportunities →</button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {/* APPOINTMENTS */}
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
          <div style={{background:"var(--navy)",color:"#fff",padding:"11px 16px",fontSize:12,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📋 Pending Forms ({counts.pending_forms||0})</span>
            <button style={{fontSize:9,padding:"2px 8px",borderRadius:3,border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"rgba(255,255,255,.7)",cursor:"pointer"}} onClick={()=>onNav("forms")}>Send Forms</button>
          </div>
          {pendingForms.length===0 && (
            <div style={{padding:"18px 14px",textAlign:"center",fontSize:11,color:"var(--green2)"}}>✓ No pending forms</div>
          )}
          {pendingForms.slice(0,6).map((f,i)=>{
            const name = f.customers ? `${f.customers.first_name||""} ${f.customers.last_name||""}`.trim() : (f.client_name||"Unknown");
            return(
            <div key={i} style={{display:"flex",gap:10,padding:"9px 14px",borderBottom:"1px solid var(--border)",alignItems:"center"}}>
              <div style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--muted)",width:48,flexShrink:0}}>{f.sent_at?new Date(f.sent_at).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—"}</div>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#dd6b20",flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:500}}>{name}</div>
                <div style={{fontSize:9,color:"var(--muted)"}}>{f.form_title||f.form_id}</div>
              </div>
              <span style={{fontSize:8,fontFamily:"DM Mono,monospace",padding:"1px 5px",borderRadius:3,background:"var(--orange-bg)",color:"var(--orange)",border:"1px solid var(--orange-border)"}}>
                Pending ⚠
              </span>
            </div>
            );
          })}
        </div>

        {/* AI ACTIVITY SUMMARY */}
        <div style={{background:"var(--navy)",borderRadius:10,padding:"16px",color:"#fff"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:12,color:"rgba(255,255,255,.8)"}}>🤖 AI Activity Today</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[{l:"Calls Made",v:briefing?.ai_calls_made??0},{l:"Texts Sent",v:briefing?.ai_texts_sent??0},{l:"Emails Sent",v:briefing?.ai_emails_sent??0},{l:"Appts Booked",v:briefing?.ai_appointments_booked??0}].map((s,i)=>(
              <div key={i} style={{textAlign:"center",background:"rgba(255,255,255,.06)",borderRadius:7,padding:"10px 8px"}}>
                <div style={{fontSize:22,fontWeight:700,color:["#4299e1","#9b72ff","#48bb78","#f0b429"][i],lineHeight:1}}>{s.v}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.5)",marginTop:3}}>{s.l}</div>
              </div>
            ))}
          </div>
          <button style={{width:"100%",marginTop:10,padding:7,borderRadius:5,border:"1px solid rgba(255,255,255,.15)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.7)",fontSize:10,cursor:"pointer",fontFamily:"DM Sans,sans-serif"}} onClick={()=>onNav("ai")}>
            View AI Agent Details →
          </button>
        </div>

        {/* GDC SNAPSHOT */}
        <div style={{background:"var(--card)",border:"1px solid var(--green-border)",borderRadius:10,padding:"16px",boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--navy)",marginBottom:10}}>💰 GDC Pipeline Snapshot</div>
          {[
            {l:"Pipeline GDC",v:fmtK1(gdc.pipeline||0),c:"#2b6cb0"},
            {l:`Est. FSA Payout (${gdc.tier_rate?Math.round(gdc.tier_rate*100)+"%":"—"})`,v:fmtK1(gdc.pipeline_fsa||0),c:"var(--green2)"},
            {l:"Issued GDC (YTD)",v:fmtK1(gdc.issued_ytd||0),c:"var(--text)"},
          ].map((r,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:12}}>
              <span style={{color:"var(--muted)"}}>{r.l}</span>
              <span style={{fontFamily:"DM Mono,monospace",fontWeight:700,color:r.c}}>{r.v}</span>
            </div>
          ))}
          <button className="btn-primary" style={{width:"100%",marginTop:10,padding:8,fontSize:11}} onClick={()=>onNav("gdc")}>Open GDC Tracker →</button>
        </div>
      </div>
    </div>
  </>);
}

// ─────────────────────────────────────────────────────────
// 7. FINANCIAL REVIEW PREP CHECKLIST — Pre-meeting
// ─────────────────────────────────────────────────────────
function ReviewPrepPage({toast}) {
  const [client, setClient] = useState("");
  const [checks, setChecks] = useState({});
  const [apptType, setApptType] = useState("general");

  const checklistsByType = {
    general:   ["Life Insurance (current coverage, 10x salary?)","Retirement accounts (IRA, 401k, pension)","Investment accounts (taxable, mutual funds)","Existing annuities","Mortgage balance and equity","Emergency fund status","Income & expenses (cash flow)","Estate documents (will, beneficiaries)","Dependents and family situation","Employer benefits review"],
    life:      ["Current life insurance policies (term, perm)","Face amount vs. 10x salary benchmark","Employer-provided coverage","Policy ownership and beneficiaries","Cash value if permanent","Income replacement need","Liability exposure worksheet","Dependents ages and needs","Business ownership (key-man need?)","Conversion deadline if term"],
    retirement:["Current 401(k) balance and contribution","IRA type (Traditional / Roth / Both)","Employer match amount","Social Security estimated benefit","Target retirement age","Monthly income goal in retirement","Tax bucket breakdown (deferred/free/taxable)","Risk tolerance score (Customer Profile)","Investment time horizon","Annuity interest (FIA, VA, SPIA)?"],
    opra:      ["Current policy details (carrier, premium)","OPRA eligibility confirmed","Home ownership verified","Auto policies with Farmers","Umbrella policy review","Life insurance gap","Referral sources in household","AgencyZoom record complete","Consent ledger current","OPRA transfer form ready"],
    business:  ["Business structure (LLC, S-Corp, etc.)","Number of employees","Buy-sell agreement exists?","Key-man life insurance in place?","Business retirement plan (401k, SEP)","Owner's personal retirement","Business value estimate","Succession plan","Executive bonus opportunity","Business information questionnaire complete"],
  };

  const items = checklistsByType[apptType] || checklistsByType.general;
  const done = items.filter((_,i)=>checks[apptType+i]).length;
  const pct = Math.round((done/items.length)*100);

  const toggle = (key) => setChecks(c=>({...c, [key]:!c[key]}));
  const reset = () => setChecks({});

  return (<>
    <div className="page-title">Financial Review Prep</div>
    <div style={{fontSize:12,color:"var(--muted)",marginBottom:16}}>Pre-populate before every client meeting · Track what you need to discuss and what documents to request</div>

    <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:16,alignItems:"start"}}>
      {/* CONTROLS */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:16,boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:10}}>Meeting Setup</div>
          <div style={{marginBottom:10}}>
            <label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:4,fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".06em"}}>Client Name</label>
            <input value={client} onChange={e=>setClient(e.target.value)} placeholder="e.g. Mary Jones"
              style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"7px 10px",fontFamily:"DM Sans,sans-serif",fontSize:12,color:"var(--text)",outline:"none"}}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:4,fontFamily:"DM Mono,monospace",textTransform:"uppercase",letterSpacing:".06em"}}>Appointment Type</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {[["general","General"],["life","Life Review"],["retirement","Retirement"],["opra","OPRA"],["business","Business Owner"]].map(([v,l])=>(
                <button key={v} onClick={()=>{setApptType(v);setChecks({});}}
                  style={{padding:"5px 10px",borderRadius:4,border:`1px solid ${apptType===v?"#2b6cb0":"var(--border)"}`,background:apptType===v?"var(--blue-bg)":"var(--bg)",color:apptType===v?"var(--blue)":"var(--muted)",fontSize:10,cursor:"pointer",fontFamily:"DM Sans,sans-serif",transition:"all .12s"}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {/* Progress */}
          <div style={{background:"var(--bg)",borderRadius:7,padding:"10px 12px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:5}}>
              <span style={{fontWeight:500}}>Prep Progress</span>
              <span style={{fontFamily:"DM Mono,monospace",fontWeight:700,color:pct===100?"var(--green2)":"#2b6cb0"}}>{done}/{items.length}</span>
            </div>
            <div style={{height:6,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct}%`,background:pct===100?"var(--green2)":"#2b6cb0",borderRadius:3,transition:"width .3s"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn-primary" style={{flex:1,padding:8,fontSize:11}} onClick={()=>toast(`Prep sheet saved for ${client||"client"}`,"success")}>💾 Save Prep</button>
            <button className="btn-secondary" style={{padding:8,fontSize:11}} onClick={reset}>Reset</button>
          </div>
        </div>

        {/* FORMS REMINDER */}
        <div style={{background:"var(--gold-bg)",border:"1px solid var(--gold-border)",borderRadius:10,padding:14}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--gold)",marginBottom:6}}>Forms to send before meeting</div>
          {[
            apptType==="business" ? "Business Information Questionnaire" : "Customer Questionnaire",
            apptType==="life" ? "Liability Exposure Worksheet" : null,
            apptType==="retirement" ? "Statement of Financial Position" : null,
            "Financial Needs Analysis Intake",
          ].filter(Boolean).map((f,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid var(--gold-border)",fontSize:11}}>
              <span style={{color:"var(--text)"}}>{f}</span>
              <button style={{fontSize:9,padding:"2px 7px",borderRadius:3,border:"none",background:"var(--gold)",color:"#fff",cursor:"pointer"}} onClick={()=>toast(`Form link sent for ${f}`,"success")}>Send</button>
            </div>
          ))}
        </div>
      </div>

      {/* CHECKLIST */}
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
        <div style={{background:"var(--navy)",color:"#fff",padding:"12px 16px",fontSize:13,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{client ? `Review Prep — ${client}` : "Review Prep Checklist"}</span>
          <span style={{fontSize:10,color:"rgba(255,255,255,.5)",fontFamily:"DM Mono,monospace"}}>{apptType.toUpperCase()} REVIEW</span>
        </div>
        {items.map((item,i)=>{
          const key = apptType+i;
          const done = !!checks[key];
          return(
            <div key={i} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:"1px solid var(--border)",cursor:"pointer",background:done?"var(--green-bg)":"var(--card)",transition:"background .12s"}}
              onClick={()=>toggle(key)}>
              <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${done?"var(--green2)":"var(--dim)"}`,background:done?"var(--green2)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all .12s"}}>
                {done&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
              </div>
              <div style={{flex:1,fontSize:12,color:done?"var(--muted)":"var(--text)",textDecoration:done?"line-through":"none",lineHeight:1.4}}>{item}</div>
            </div>
          );
        })}
        {pct===100 && (
          <div style={{padding:"14px 16px",background:"var(--green-bg)",textAlign:"center",fontSize:12,color:"var(--green)",fontWeight:600}}>
            ✅ All items reviewed — ready for the meeting!
          </div>
        )}
      </div>
    </div>
  </>);
}

const ASSISTANT_SUGGESTIONS=[
  "Draft a friendly SMS reminding a client to complete their questionnaire",
  "Explain the 10-3-1 activity model",
  "How does the GDC tier payout work?",
  "Write a voicemail script for a term-conversion follow-up",
];

function AssistantModal({open,onClose}){
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [sending,setSending]=useState(false);
  const [error,setError]=useState("");

  const send=useCallback(async(text)=>{
    const content=(text??input).trim();
    if(!content||sending) return;
    setError("");
    const next=[...messages,{role:"user",content}];
    setMessages(next);
    setInput("");
    setSending(true);
    try{
      const res=await fetch("/api/assistant",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({messages:next}),
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||"Assistant unavailable");
      setMessages(m=>[...m,{role:"assistant",content:data.reply||"(no response)"}]);
    }catch(e){
      setError(e.message||"Something went wrong");
      setMessages(m=>[...m,{role:"assistant",content:"Sorry — I couldn't reach the assistant just now. Please try again."}]);
    }finally{
      setSending(false);
    }
  },[input,messages,sending]);

  if(!open) return null;

  return(
    <div className="asst-overlay" onClick={onClose}>
      <div className="asst-panel" onClick={e=>e.stopPropagation()}>
        <div className="asst-head">
          <div>
            <div className="asst-head-title">✦ FSOS Assistant</div>
            <div className="asst-head-sub">Compliance-aware · educational use only</div>
          </div>
          <button className="asst-close" onClick={onClose} aria-label="Close assistant">×</button>
        </div>
        <div className="asst-body">
          {messages.length===0&&(
            <div className="asst-hint">
              Hi Markist — I can help you navigate FSOS, draft client outreach for your review,
              and explain concepts. I never recommend specific products or make suitability calls.
              <div>
                {ASSISTANT_SUGGESTIONS.map((s,i)=>(
                  <span className="asst-chip" key={i} onClick={()=>send(s)}>{s}</span>
                ))}
              </div>
            </div>
          )}
          {messages.map((m,i)=>(
            <div className={`asst-msg ${m.role}`} key={i}>{m.content}</div>
          ))}
          {sending&&<div className="asst-typing">Assistant is typing…</div>}
        </div>
        <div className="asst-foot">
          <textarea
            className="asst-input"
            rows={1}
            value={input}
            placeholder="Ask the assistant…"
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          />
          <button className="asst-send" disabled={sending||!input.trim()} onClick={()=>send()}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// CAMPAIGNS — drip SMS/email sequences (#6)
// GET/POST /api/campaigns · POST /api/campaigns/enroll · /run
// ─────────────────────────────────────────────────────────
const ENROLL_PIPELINES = ["","general","conversions","opra","life","retirement","business","owner"];
function CampaignsPage({ toast }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("email");
  const [steps, setSteps] = useState([{ delay_days:0, subject:"", body:"" }]);
  const [saving, setSaving] = useState(false);
  const [enrollFor, setEnrollFor] = useState(null); // campaign_id
  const [enrollPipeline, setEnrollPipeline] = useState("");
  const [enrollSource, setEnrollSource] = useState("");

  const load = () => { setLoading(true); fetch("/api/campaigns").then(r=>r.ok?r.json():{campaigns:[]}).then(d=>setCampaigns(d.campaigns||[])).catch(()=>setCampaigns([])).finally(()=>setLoading(false)); };
  useEffect(load, []);

  const setStep = (i, key, val) => setSteps(s => s.map((st,idx)=> idx===i ? {...st,[key]:val} : st));
  const create = async () => {
    if (!name.trim()) { toast("Name the campaign","error"); return; }
    if (steps.some(s=>!s.body.trim())) { toast("Every step needs a message body","error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ name:name.trim(), channel, steps: steps.map(s=>({ delay_days:Number(s.delay_days)||0, subject:s.subject||undefined, body:s.body })) }) });
      if (!res.ok) { const d=await res.json().catch(()=>({})); toast(d.error||"Could not create","error"); }
      else { setName(""); setSteps([{delay_days:0,subject:"",body:""}]); toast("Campaign created","success"); load(); }
    } catch { toast("Network error","error"); } finally { setSaving(false); }
  };
  const enroll = async (campaign_id) => {
    if (!enrollPipeline && !enrollSource.trim()) { toast("Choose a pipeline or enter a source","error"); return; }
    try {
      const res = await fetch("/api/campaigns/enroll", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ campaign_id, pipeline:enrollPipeline||undefined, source:enrollSource.trim()||undefined }) });
      const d = await res.json().catch(()=>({}));
      if (!res.ok) toast(d.error||"Enroll failed","error");
      else { toast(`Enrolled ${d.enrolled} of ${d.matched} matched`,"success"); setEnrollFor(null); setEnrollPipeline(""); setEnrollSource(""); load(); }
    } catch { toast("Network error","error"); }
  };
  const run = async (campaign_id) => {
    try {
      const res = await fetch("/api/campaigns/run", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ campaign_id }) });
      const d = await res.json().catch(()=>({}));
      if (!res.ok) toast(d.error||"Run failed","error");
      else { const c=d.counts||{}; toast(`Sent ${c.sent||0} · skipped ${c.skipped||0} · failed ${c.failed||0} · completed ${c.completed||0}`, (c.failed?"info":"success")); load(); }
    } catch { toast("Network error","error"); }
  };

  const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:16, boxShadow:"var(--shadow)" };
  const inp = { padding:"7px 9px", border:"1px solid var(--border)", borderRadius:6, fontSize:11, fontFamily:"DM Sans,sans-serif", width:"100%" };

  return (
    <div style={{display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1.2fr)", gap:16, alignItems:"start"}}>
      {/* Create */}
      <div style={card}>
        <div style={{fontSize:14, fontWeight:700, color:"var(--navy)", marginBottom:12}}>New Drip Campaign</div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 110px", gap:8, marginBottom:10}}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Campaign name" style={inp}/>
          <select value={channel} onChange={e=>setChannel(e.target.value)} style={{...inp, background:"#fff"}}>
            <option value="email">Email</option><option value="sms">SMS</option>
          </select>
        </div>
        <div style={{fontSize:10, color:"var(--muted)", marginBottom:8}}>Steps send in order; delay is days after the previous step. Use {"{first_name}"} for personalization.</div>
        {steps.map((s,i)=>(
          <div key={i} style={{border:"1px solid var(--border)", borderRadius:8, padding:10, marginBottom:8}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
              <span style={{fontSize:10, fontWeight:700, color:"var(--navy)"}}>Step {i+1}</span>
              <div style={{display:"flex", alignItems:"center", gap:6}}>
                <span style={{fontSize:9, color:"var(--muted)"}}>after</span>
                <input type="number" min="0" value={s.delay_days} onChange={e=>setStep(i,"delay_days",e.target.value)} style={{...inp, width:52, padding:"4px 6px"}}/>
                <span style={{fontSize:9, color:"var(--muted)"}}>days</span>
                {steps.length>1 && <button className="btn-secondary" style={{fontSize:9, padding:"2px 7px"}} onClick={()=>setSteps(steps.filter((_,idx)=>idx!==i))}>✕</button>}
              </div>
            </div>
            {channel==="email" && <input value={s.subject} onChange={e=>setStep(i,"subject",e.target.value)} placeholder="Subject" style={{...inp, marginBottom:6}}/>}
            <textarea value={s.body} onChange={e=>setStep(i,"body",e.target.value)} placeholder="Message body…" rows={3} style={{...inp, resize:"vertical"}}/>
          </div>
        ))}
        <button className="btn-secondary" style={{fontSize:10, padding:"5px 10px", marginRight:8}} onClick={()=>setSteps([...steps,{delay_days:3,subject:"",body:""}])}>+ Add step</button>
        <button className="btn-primary" disabled={saving} style={{fontSize:11, padding:"7px 16px"}} onClick={create}>{saving?"Saving…":"Create Campaign"}</button>
      </div>

      {/* List */}
      <div>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
          <div style={{fontSize:14, fontWeight:700, color:"var(--navy)"}}>Campaigns</div>
          <button className="btn-secondary" style={{fontSize:10, padding:"4px 10px"}} onClick={load}>↻ Refresh</button>
        </div>
        {loading && <div style={{fontSize:12, color:"var(--muted)"}}>Loading…</div>}
        {!loading && campaigns.length===0 && <div style={{...card, textAlign:"center", fontSize:12, color:"var(--muted)"}}>No campaigns yet. Build one on the left.</div>}
        <div style={{display:"flex", flexDirection:"column", gap:12}}>
          {campaigns.map(c=>(
            <div key={c.campaign_id} style={card}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:13, fontWeight:700, color:"var(--navy)"}}>{c.name}</div>
                  <div style={{fontSize:10, color:"var(--muted)"}}>{c.channel} · {(c.steps||[]).length} steps · {c.enrollments?.active||0} active / {c.enrollments?.completed||0} done / {c.enrollments?.total||0} total</div>
                </div>
                <span style={{fontSize:14}}>{c.channel==="email"?"✉":"💬"}</span>
              </div>
              <div style={{display:"flex", gap:6, marginTop:10}}>
                <button className="btn-secondary" style={{fontSize:10, padding:"5px 11px"}} onClick={()=>setEnrollFor(enrollFor===c.campaign_id?null:c.campaign_id)}>Enroll</button>
                <button className="btn-primary" style={{fontSize:10, padding:"5px 11px"}} onClick={()=>run(c.campaign_id)}>▶ Run due sends</button>
              </div>
              {enrollFor===c.campaign_id && (
                <div style={{marginTop:10, padding:10, background:"var(--bg2)", borderRadius:8, display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, alignItems:"center"}}>
                  <select value={enrollPipeline} onChange={e=>setEnrollPipeline(e.target.value)} style={{...inp, background:"#fff"}}>
                    {ENROLL_PIPELINES.map(p=><option key={p} value={p}>{p?`Pipeline: ${p}`:"— pipeline —"}</option>)}
                  </select>
                  <input value={enrollSource} onChange={e=>setEnrollSource(e.target.value)} placeholder="or source (e.g. apex)" style={inp}/>
                  <button className="btn-primary" style={{fontSize:10, padding:"6px 12px"}} onClick={()=>enroll(c.campaign_id)}>Enroll</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{fontSize:9, color:"var(--muted)", marginTop:12, lineHeight:1.5}}>
          Sends respect consent (email → email consent, SMS → SMS consent) and skip contacts without it. Point a daily
          scheduler (Make.com / cron) at <b>POST /api/campaigns/run</b> to advance sequences automatically.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// REPORTS — analytics dashboard (#14) · GET /api/reports
// ─────────────────────────────────────────────────────────
const CHART_COLORS = ["#4299e1","#38a169","#6b46c1","#b7791f","#e53e3e","#0bc5ea","#ed8936","#805ad5"];
const PIPELINE_LABELS = { general:"General", conversions:"Conversions", opra:"OPRA", life:"Life", retirement:"Retirement", business:"Business", owner:"Owner" };

function BarList({ items, valueKey="count", labelMap, money }) {
  const max = Math.max(1, ...items.map(i => Number(i[valueKey])||0));
  const fmt = v => money ? "$"+Number(v).toLocaleString("en-US") : Number(v).toLocaleString("en-US");
  if (!items.length) return <div style={{fontSize:11, color:"var(--muted)", padding:"8px 0"}}>No data yet.</div>;
  return (
    <div style={{display:"flex", flexDirection:"column", gap:8}}>
      {items.map((it,i)=>{
        const v = Number(it[valueKey])||0;
        const label = (labelMap && labelMap[it.label]) || it.label || "—";
        return (
          <div key={i} style={{display:"grid", gridTemplateColumns:"110px 1fr 56px", gap:10, alignItems:"center"}}>
            <span style={{fontSize:11, color:"var(--text)", textTransform:"capitalize", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}} title={label}>{label}</span>
            <div style={{background:"var(--bg2)", borderRadius:4, height:14, overflow:"hidden"}}>
              <div style={{width:`${(v/max)*100}%`, height:"100%", background:CHART_COLORS[i%CHART_COLORS.length], borderRadius:4, minWidth: v>0?4:0}}/>
            </div>
            <span style={{fontSize:11, fontWeight:600, textAlign:"right", color:"var(--navy)"}}>{fmt(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function GdcTrend({ data }) {
  const max = Math.max(1, ...data.map(d => d.gdc));
  return (
    <div style={{display:"flex", alignItems:"flex-end", gap:10, height:130, paddingTop:8}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4}}>
          <div style={{fontSize:9, color:"var(--muted)", fontWeight:600}}>{d.gdc>0?"$"+(d.gdc/1000).toFixed(d.gdc>=10000?0:1)+"k":""}</div>
          <div style={{width:"100%", maxWidth:34, height:`${Math.max((d.gdc/max)*90,2)}px`, background:"linear-gradient(180deg,#4299e1,#2b6cb0)", borderRadius:"4px 4px 0 0", minHeight:2}}/>
          <div style={{fontSize:9, color:"var(--muted)"}}>{d.month.slice(5)}/{d.month.slice(2,4)}</div>
        </div>
      ))}
    </div>
  );
}

function ReportsPage({ toast }) {
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    fetch("/api/reports").then(async r=>{ if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||`HTTP ${r.status}`); return r.json(); })
      .then(setRep).catch(e=>setError(String(e.message||e))).finally(()=>setLoading(false));
  };
  useEffect(load, []);

  const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:16, boxShadow:"var(--shadow)" };
  const T = rep?.totals || {};
  const kpi = (label,val,color) => (
    <div style={{...card, padding:14}}>
      <div style={{fontSize:24, fontWeight:700, color:color||"var(--navy)"}}>{val}</div>
      <div style={{fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:".04em", marginTop:2}}>{label}</div>
    </div>
  );
  const panel = (title, node) => (
    <div style={card}><div style={{fontSize:12, fontWeight:700, color:"var(--navy)", marginBottom:12}}>{title}</div>{node}</div>
  );

  return (
    <div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14}}>
        <div style={{fontSize:11, color:"var(--muted)"}}>{rep?`Generated ${new Date(rep.generated_at).toLocaleString("en-US",{hour:"numeric",minute:"2-digit"})}`:""}</div>
        <button className="btn-secondary" style={{fontSize:11, padding:"5px 12px"}} onClick={load}>↻ Refresh</button>
      </div>
      {loading && <div style={{fontSize:12, color:"var(--muted)"}}>Loading analytics…</div>}
      {error && <div style={{...card, color:"var(--red)", fontSize:12}}>Could not load reports: {error}</div>}
      {rep && !error && (<>
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:16}}>
          {kpi("Customers", (T.customers||0).toLocaleString())}
          {kpi("Policies", (T.policies||0).toLocaleString())}
          {kpi("Open Cases", T.open_cases||0)}
          {kpi("Issued Cases", T.issued_cases||0, "var(--green2)")}
          {kpi("GDC Issued", "$"+(T.gdc_issued||0).toLocaleString(), "var(--green2)")}
          {kpi("Overdue Tasks", T.overdue_tasks||0, (T.overdue_tasks>0)?"var(--red)":"var(--navy)")}
        </div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:14}}>
          {panel("GDC by Month (issued)", <GdcTrend data={rep.gdc_by_month||[]}/>)}
          {panel("Pipeline Mix", <BarList items={rep.pipelines||[]} labelMap={PIPELINE_LABELS}/>)}
          {panel("Lead Sources", <BarList items={rep.sources||[]}/>)}
          {panel("Case Status", <BarList items={rep.case_status||[]}/>)}
          {panel("Activity — last 30 days", <BarList items={rep.activity_30d||[]}/>)}
        </div>
      </>)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// FOLLOW-UPS — Tasks (#9) + Renewal & anniversary tracker (#10)
// GET/POST/PATCH /api/tasks · GET /api/renewals
// ─────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0,10);
const addDaysStr = (n) => { const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const PRI_STYLE = { high:{bg:"#fed7d7",fg:"#c53030"}, medium:{bg:"#feebc8",fg:"#b7791f"}, low:{bg:"#e2e8f0",fg:"#4a5568"} };

function TasksPanel({ toast, onOpenCustomer }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(todayStr());
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/tasks?status=open&limit=300").then(r=>r.ok?r.json():{tasks:[]})
      .then(d=>setTasks(d.tasks||[])).catch(()=>setTasks([])).finally(()=>setLoading(false));
  };
  useEffect(load, []);

  const add = async () => {
    if (!title.trim()) { toast("Enter a task title", "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ title: title.trim(), due_date: due || undefined, priority }) });
      if (!res.ok) { const d=await res.json().catch(()=>({})); toast(d.error||"Could not add task","error"); }
      else { setTitle(""); toast("Task added","success"); load(); }
    } catch { toast("Network error","error"); } finally { setSaving(false); }
  };
  const patch = async (task_id, body, msg) => {
    try {
      const res = await fetch("/api/tasks", { method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ task_id, ...body }) });
      if (!res.ok) { toast("Update failed","error"); return; }
      if (msg) toast(msg,"success"); load();
    } catch { toast("Network error","error"); }
  };

  const t0 = todayStr(), t7 = addDaysStr(7);
  const buckets = { overdue:[], today:[], week:[], later:[] };
  for (const t of tasks) {
    const d = t.due_date;
    if (!d) buckets.later.push(t);
    else if (d < t0) buckets.overdue.push(t);
    else if (d === t0) buckets.today.push(t);
    else if (d <= t7) buckets.week.push(t);
    else buckets.later.push(t);
  }
  const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, boxShadow:"var(--shadow)" };
  const inp = { padding:"8px 10px", border:"1px solid var(--border)", borderRadius:6, fontSize:12, fontFamily:"DM Sans,sans-serif" };

  const Row = (t) => {
    const cust = t.customers ? `${t.customers.first_name||""} ${t.customers.last_name||""}`.trim() : null;
    const ps = PRI_STYLE[t.priority] || PRI_STYLE.medium;
    return (
      <div key={t.task_id} style={{display:"grid", gridTemplateColumns:"auto 1fr auto", gap:10, alignItems:"center", padding:"10px 14px", borderBottom:"1px solid var(--border)"}}>
        <input type="checkbox" onChange={()=>patch(t.task_id,{status:"done"},"Task completed")} style={{width:16,height:16,cursor:"pointer"}}/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:12, fontWeight:600, color:"var(--navy)"}}>{t.title}</div>
          <div style={{fontSize:10, color:"var(--muted)"}}>
            {t.due_date||"no date"}
            {cust && <> · <span style={{color:"var(--blue)", cursor:"pointer"}} onClick={()=>t.customer_id&&onOpenCustomer(t.customer_id)}>{cust}</span></>}
            {t.source==="renewal" && " · renewal"}
          </div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:6}}>
          <span style={{fontSize:8, fontWeight:700, textTransform:"uppercase", background:ps.bg, color:ps.fg, borderRadius:20, padding:"2px 7px"}}>{t.priority}</span>
          <button className="btn-secondary" style={{fontSize:9, padding:"3px 7px"}} onClick={()=>patch(t.task_id,{due_date:addDaysStr(7)},"Snoozed 7 days")} title="Snooze 7 days">⏰</button>
        </div>
      </div>
    );
  };
  const Bucket = (label, items, color) => items.length>0 && (
    <div style={{...card, marginBottom:12, overflow:"hidden"}}>
      <div style={{padding:"8px 14px", fontSize:11, fontWeight:700, color, borderBottom:"1px solid var(--border)", background:"var(--bg2)"}}>{label} ({items.length})</div>
      {items.map(Row)}
    </div>
  );

  return (
    <div>
      <div style={{...card, padding:12, marginBottom:16, display:"grid", gridTemplateColumns:"1fr 130px 120px auto", gap:8, alignItems:"center"}}>
        <input value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")add();}} placeholder="New follow-up task…" style={inp}/>
        <input type="date" value={due} onChange={e=>setDue(e.target.value)} style={inp}/>
        <select value={priority} onChange={e=>setPriority(e.target.value)} style={{...inp, background:"#fff"}}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <button className="btn-primary" disabled={saving} style={{fontSize:12, padding:"8px 16px"}} onClick={add}>{saving?"…":"+ Add"}</button>
      </div>
      {loading && <div style={{fontSize:12, color:"var(--muted)"}}>Loading tasks…</div>}
      {!loading && tasks.length===0 && <div style={{...card, padding:24, textAlign:"center", fontSize:12, color:"var(--muted)"}}>No open tasks. Add one above or create follow-ups from the Renewals tab.</div>}
      {!loading && <>
        {Bucket("Overdue", buckets.overdue, "var(--red)")}
        {Bucket("Today", buckets.today, "var(--navy)")}
        {Bucket("This Week", buckets.week, "#b7791f")}
        {Bucket("Later", buckets.later, "var(--muted)")}
      </>}
    </div>
  );
}

const RENEWAL_META = {
  term_conversion: { icon:"⏳", color:"var(--red)", },
  policy_renewal: { icon:"🔁", color:"#b7791f" },
  policy_anniversary: { icon:"📆", color:"#2b6cb0" },
  birthday: { icon:"🎂", color:"#6b46c1" },
};
function RenewalsPanel({ toast, onOpenCustomer }) {
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState(90);

  const load = (w) => {
    setLoading(true);
    fetch(`/api/renewals?window=${w}`).then(r=>r.ok?r.json():{events:[]})
      .then(d=>{ setEvents(d.events||[]); setCounts(d.counts||{}); }).catch(()=>setEvents([])).finally(()=>setLoading(false));
  };
  useEffect(()=>load(win), [win]);

  const createTask = async (e) => {
    const labels = { term_conversion:"Term conversion review", policy_renewal:"Policy renewal review", policy_anniversary:"Policy anniversary check-in", birthday:"Birthday outreach" };
    try {
      const res = await fetch("/api/tasks", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ title:`${labels[e.type]||"Follow up"} — ${e.customer_name}`, customer_id:e.customer_id||undefined, due_date:e.date, priority:e.type==="term_conversion"?"high":"medium", source:"renewal" }) });
      if (!res.ok) toast("Could not create task","error"); else toast("Follow-up task created","success");
    } catch { toast("Network error","error"); }
  };

  const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, boxShadow:"var(--shadow)" };
  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap"}}>
        <span style={{fontSize:11, color:"var(--muted)"}}>Window:</span>
        {[30,60,90,180].map(w=>(
          <button key={w} onClick={()=>setWin(w)} className={win===w?"btn-primary":"btn-secondary"} style={{fontSize:10, padding:"4px 10px"}}>{w}d</button>
        ))}
        <div style={{marginLeft:"auto", display:"flex", gap:10, fontSize:10, color:"var(--muted)"}}>
          {Object.entries(RENEWAL_META).map(([k,m])=> counts[k]>0 && <span key={k}>{m.icon} {counts[k]}</span>)}
        </div>
      </div>
      {loading && <div style={{fontSize:12, color:"var(--muted)"}}>Loading upcoming events…</div>}
      {!loading && events.length===0 && <div style={{...card, padding:24, textAlign:"center", fontSize:12, color:"var(--muted)"}}>No renewals, anniversaries, or birthdays in the next {win} days.</div>}
      {!loading && events.length>0 && (
        <div style={{...card, overflow:"hidden"}}>
          {events.map((e,i)=>{
            const m = RENEWAL_META[e.type] || {icon:"•",color:"var(--muted)"};
            return (
              <div key={i} style={{display:"grid", gridTemplateColumns:"auto 1fr auto auto", gap:12, alignItems:"center", padding:"11px 14px", borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:16}}>{m.icon}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12, fontWeight:600, color:"var(--navy)", cursor:e.customer_id?"pointer":"default"}} onClick={()=>e.customer_id&&onOpenCustomer(e.customer_id)}>{e.customer_name}</div>
                  <div style={{fontSize:10, color:"var(--muted)"}}>{e.label}{e.detail?` · ${e.detail}`:""}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11, fontWeight:600, color:m.color}}>{e.date}</div>
                  <div style={{fontSize:9, color:"var(--muted)"}}>{e.days_until===0?"today":`in ${e.days_until}d`}</div>
                </div>
                <div style={{display:"flex", gap:5}}>
                  {e.phone && <a className="btn-secondary" href={`tel:${e.phone}`} style={{fontSize:9, padding:"3px 7px", textDecoration:"none"}}>📞</a>}
                  <button className="btn-primary" style={{fontSize:9, padding:"3px 8px"}} onClick={()=>createTask(e)}>+ Task</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FollowUpsPage({ toast, onOpenCustomer }) {
  const [tab, setTab] = useState("tasks");
  const tabBtn = (id, label) => (
    <button onClick={()=>setTab(id)} style={{background:"transparent", border:"none", borderBottom:tab===id?"2px solid var(--blue)":"2px solid transparent", color:tab===id?"var(--navy)":"var(--muted)", fontWeight:tab===id?700:500, fontSize:13, padding:"8px 4px", marginRight:18, cursor:"pointer", fontFamily:"DM Sans,sans-serif"}}>{label}</button>
  );
  return (
    <div>
      <div style={{display:"flex", borderBottom:"1px solid var(--border)", marginBottom:16}}>
        {tabBtn("tasks","✅ Tasks")}
        {tabBtn("renewals","🔔 Renewals & Anniversaries")}
      </div>
      {tab==="tasks" ? <TasksPanel toast={toast} onOpenCustomer={onOpenCustomer}/> : <RenewalsPanel toast={toast} onOpenCustomer={onOpenCustomer}/>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// TOP SEARCH — live search across clients + agencies (GET /api/search)
// ─────────────────────────────────────────────────────────
function TopSearch({ onOpenCustomer, toast }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() : { results: [] })
        .then(d => { setResults(d.results || []); setOpen(true); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (r) => {
    setOpen(false); setQ("");
    if (r.type === "customer") onOpenCustomer(r.id);
    else toast("Open the Agency Owners page to manage this partner", "info");
  };

  return (
    <div ref={boxRef} style={{flex:1, maxWidth:320, margin:"0 16px", position:"relative"}}>
      <span style={{position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", fontSize:13, pointerEvents:"none"}}>🔍</span>
      <input placeholder="Search clients, agencies…" value={q}
        onChange={e=>setQ(e.target.value)} onFocus={()=>{ if(results.length) setOpen(true); }}
        style={{width:"100%", background:"var(--bg)", border:"1px solid var(--border)", borderRadius:6, padding:"7px 10px 7px 32px", fontFamily:"DM Sans,sans-serif", fontSize:11, color:"var(--text)", outline:"none"}}/>
      {open && (q.trim().length >= 2) && (
        <div style={{position:"absolute", top:"110%", left:0, right:0, background:"var(--card)", border:"1px solid var(--border)", borderRadius:8, boxShadow:"var(--shadow2)", zIndex:60, maxHeight:360, overflowY:"auto"}}>
          {loading && <div style={{padding:"10px 12px", fontSize:11, color:"var(--muted)"}}>Searching…</div>}
          {!loading && results.length === 0 && <div style={{padding:"10px 12px", fontSize:11, color:"var(--muted)"}}>No matches for “{q}”.</div>}
          {!loading && results.map((r,i)=>(
            <div key={i} onClick={()=>choose(r)} style={{display:"flex", alignItems:"center", gap:9, padding:"8px 12px", cursor:"pointer", borderBottom:"1px solid var(--border)"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--bg2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:13}}>{r.type==="customer"?"👤":"🏢"}</span>
              <div style={{minWidth:0, flex:1}}>
                <div style={{fontSize:12, fontWeight:600, color:"var(--navy)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{r.title}</div>
                <div style={{fontSize:10, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{r.subtitle}</div>
              </div>
              {r.stage && <span style={{fontSize:8, background:"#f0e9ff", color:"#6b46c1", border:"1px solid #d6bcfa", borderRadius:3, padding:"2px 5px", whiteSpace:"nowrap"}}>◆ {r.stage}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// CLIENT DRAWER — 360° profile + AI next-best-action
// GET /api/customers/detail · POST /api/customers/next-action
// ─────────────────────────────────────────────────────────
function ClientDrawer({ customerId, onClose, toast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [na, setNa] = useState(null);
  const [naLoading, setNaLoading] = useState(false);
  const [mp, setMp] = useState(null);
  const [mpLoading, setMpLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [docs, setDocs] = useState([]);
  const [docBusy, setDocBusy] = useState(false);

  const loadTasks = () => {
    if (!customerId) return;
    fetch(`/api/tasks?status=open&customer_id=${encodeURIComponent(customerId)}`)
      .then(r=>r.ok?r.json():{tasks:[]}).then(d=>setTasks(d.tasks||[])).catch(()=>setTasks([]));
  };
  const loadDocs = () => {
    if (!customerId) return;
    fetch(`/api/customers/documents?customer_id=${encodeURIComponent(customerId)}`)
      .then(r=>r.ok?r.json():{documents:[]}).then(d=>setDocs(d.documents||[])).catch(()=>setDocs([]));
  };
  const uploadDoc = async (fileList) => {
    const f = fileList && fileList[0];
    if (!f) return;
    if (f.size > 15*1024*1024) { toast("File exceeds the 15MB limit","error"); return; }
    setDocBusy(true);
    try {
      const fd = new FormData(); fd.append("customer_id", customerId); fd.append("file", f);
      const res = await fetch("/api/customers/documents", { method:"POST", body: fd });
      const d = await res.json().catch(()=>({}));
      if (!res.ok) toast(d.error || "Upload failed","error");
      else { toast("Document uploaded","success"); loadDocs(); }
    } catch { toast("Network error","error"); } finally { setDocBusy(false); }
  };

  useEffect(() => {
    if (!customerId) { setData(null); setNa(null); setMp(null); setEnr(null); setError(null); setTasks([]); setDocs([]); return; }
    setLoading(true); setError(null); setNa(null); setMp(null); setEnr(null);
    fetch(`/api/customers/detail?id=${encodeURIComponent(customerId)}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || `HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setError(String(e.message || e)))
      .finally(() => setLoading(false));
    loadTasks();
    loadDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    try {
      const res = await fetch("/api/tasks", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ title: taskTitle.trim(), customer_id: customerId }) });
      if (!res.ok) { toast("Could not add follow-up","error"); return; }
      setTaskTitle(""); toast("Follow-up added","success"); loadTasks();
    } catch { toast("Network error","error"); }
  };
  const completeTask = async (id) => {
    try {
      await fetch("/api/tasks", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ task_id:id, status:"done" }) });
      loadTasks();
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    if (customerId) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [customerId, onClose]);

  const runNextAction = async () => {
    setNaLoading(true);
    try {
      const res = await fetch("/api/customers/next-action", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ customer_id: customerId }),
      });
      const d = await res.json().catch(()=>({}));
      if (!res.ok) { toast(d.error || `AI unavailable (HTTP ${res.status})`, "error"); }
      else setNa(d);
    } catch { toast("Network error requesting recommendation", "error"); }
    finally { setNaLoading(false); }
  };

  const runMeetingPrep = async () => {
    setMpLoading(true);
    try {
      const res = await fetch("/api/customers/meeting-prep", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ customer_id: customerId }) });
      const d = await res.json().catch(()=>({}));
      if (!res.ok) toast(d.error || `AI unavailable (HTTP ${res.status})`, "error");
      else setMp(d);
    } catch { toast("Network error", "error"); }
    finally { setMpLoading(false); }
  };

  const [enr, setEnr] = useState(null);
  const [enrLoading, setEnrLoading] = useState(false);
  const runEnrich = async () => {
    setEnrLoading(true);
    try {
      const res = await fetch("/api/customers/enrich", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ customer_id: customerId }) });
      const d = await res.json().catch(()=>({}));
      if (!res.ok) toast(d.error || `Enrichment unavailable (HTTP ${res.status})`, "error");
      else if (!d.matched) { toast("No Apollo match found", "info"); setEnr({ none:true }); }
      else { setEnr(d.person); toast("Contact enriched", "success"); }
    } catch { toast("Network error", "error"); }
    finally { setEnrLoading(false); }
  };

  if (!customerId) return null;
  const c = data?.customer || {};
  const money = v => v==null ? "—" : "$"+Number(v).toLocaleString("en-US");
  const date = v => v ? new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
  const copy = (txt,label) => { navigator.clipboard?.writeText(txt||""); toast(`${label} copied`, "success"); };
  const sec = { fontSize:11, fontWeight:700, color:"var(--navy)", textTransform:"uppercase", letterSpacing:".04em", margin:"16px 0 8px" };
  const chip = (label,val) => (
    <div><div style={{fontSize:9, color:"var(--muted)", textTransform:"uppercase", letterSpacing:".03em"}}>{label}</div>
      <div style={{fontSize:12, color:"var(--text)", fontWeight:500}}>{val==null||val===""?"—":val}</div></div>
  );
  const priColor = { high:"var(--red)", medium:"#b7791f", low:"var(--muted)" };

  return (
    <div style={{position:"fixed", inset:0, zIndex:120, display:"flex", justifyContent:"flex-end"}}>
      <div onClick={onClose} style={{position:"absolute", inset:0, background:"rgba(15,30,54,.35)"}}/>
      <div style={{position:"relative", width:"min(480px,94vw)", height:"100%", background:"var(--bg)", boxShadow:"var(--shadow2)", overflowY:"auto"}}>
        <div style={{position:"sticky", top:0, background:"var(--navy)", color:"#fff", padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", zIndex:2}}>
          <div>
            <div style={{fontSize:16, fontWeight:700}}>{loading?"Loading…":`${c.first_name||""} ${c.last_name||""}`.trim()||"Client"}</div>
            {data && <div style={{fontSize:11, opacity:.8, marginTop:2}}>
              {[c.email, c.phone].filter(Boolean).join(" · ")||"No contact info"}
            </div>}
          </div>
          <button onClick={onClose} style={{background:"transparent", border:"none", color:"#fff", fontSize:20, cursor:"pointer", lineHeight:1}}>×</button>
        </div>

        <div style={{padding:"4px 18px 28px"}}>
          {error && <div style={{marginTop:14, fontSize:12, color:"var(--red)", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, padding:12}}>{error}</div>}
          {data && (<>
            {/* Quick actions */}
            <div style={{display:"flex", gap:8, marginTop:14, flexWrap:"wrap"}}>
              {c.phone && <a className="btn-secondary" style={{fontSize:11, padding:"6px 12px", textDecoration:"none"}} href={`tel:${c.phone}`}>📞 Call</a>}
              {c.email && <a className="btn-secondary" style={{fontSize:11, padding:"6px 12px", textDecoration:"none"}} href={`mailto:${c.email}`}>✉ Email</a>}
              <button className="btn-secondary" disabled={enrLoading} style={{fontSize:11, padding:"6px 12px", opacity:enrLoading?.6:1}} onClick={runEnrich} title="Enrich with Apollo (title, company, LinkedIn)">{enrLoading?"Enriching…":"✨ Enrich"}</button>
              {data.ghl?.stage && <span style={{fontSize:10, background:"#f0e9ff", color:"#6b46c1", border:"1px solid #d6bcfa", borderRadius:4, padding:"5px 9px"}}>◆ {data.ghl.pipeline} · {data.ghl.stage}</span>}
            </div>
            {enr && !enr.none && (
              <div style={{marginTop:10, border:"1px solid var(--border)", background:"var(--bg2)", borderRadius:8, padding:12, fontSize:11}}>
                <div style={{fontSize:9, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", marginBottom:6}}>Apollo enrichment</div>
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 12px"}}>
                  {enr.title && <div><b>Title:</b> {enr.title}</div>}
                  {enr.company && <div><b>Company:</b> {enr.company}</div>}
                  {enr.industry && <div><b>Industry:</b> {enr.industry}</div>}
                  {enr.seniority && <div><b>Seniority:</b> {enr.seniority}</div>}
                  {(enr.city||enr.state) && <div><b>Location:</b> {[enr.city,enr.state].filter(Boolean).join(", ")}</div>}
                </div>
                {enr.linkedin_url && <a href={enr.linkedin_url} target="_blank" rel="noreferrer" style={{color:"var(--blue)", fontSize:11, display:"inline-block", marginTop:6}}>LinkedIn ↗</a>}
              </div>
            )}

            {/* AI Next Best Action */}
            <div style={{marginTop:16, border:"1px solid #d6bcfa", background:"#faf7ff", borderRadius:10, padding:14}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <div style={{fontSize:12, fontWeight:700, color:"#6b46c1"}}>✦ AI Next Best Action</div>
                {!na && <button className="btn-primary" disabled={naLoading} style={{fontSize:10, padding:"5px 11px", opacity:naLoading?.6:1}} onClick={runNextAction}>{naLoading?"Thinking…":"Suggest"}</button>}
              </div>
              {na && (<div style={{marginTop:10}}>
                <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
                  <span style={{fontSize:9, fontWeight:700, textTransform:"uppercase", color:"#fff", background:priColor[na.priority]||"var(--muted)", borderRadius:20, padding:"2px 8px"}}>{na.priority}</span>
                  <span style={{fontSize:13, fontWeight:600, color:"var(--navy)"}}>{na.action}</span>
                </div>
                <div style={{fontSize:11, color:"var(--muted)", lineHeight:1.5, marginBottom:10}}>{na.rationale}</div>
                {na.draft_sms && <div style={{marginBottom:8}}>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3}}>
                    <span style={{fontSize:9, fontWeight:700, color:"var(--muted)", textTransform:"uppercase"}}>Draft SMS</span>
                    <button className="btn-secondary" style={{fontSize:8, padding:"2px 7px"}} onClick={()=>copy(na.draft_sms,"SMS")}>Copy</button>
                  </div>
                  <div style={{fontSize:11, background:"#fff", border:"1px solid var(--border)", borderRadius:6, padding:8, lineHeight:1.5}}>{na.draft_sms}</div>
                </div>}
                {na.draft_email_body && <div>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3}}>
                    <span style={{fontSize:9, fontWeight:700, color:"var(--muted)", textTransform:"uppercase"}}>Draft Email — {na.draft_email_subject}</span>
                    <button className="btn-secondary" style={{fontSize:8, padding:"2px 7px"}} onClick={()=>copy(`Subject: ${na.draft_email_subject}\n\n${na.draft_email_body}`,"Email")}>Copy</button>
                  </div>
                  <div style={{fontSize:11, background:"#fff", border:"1px solid var(--border)", borderRadius:6, padding:8, lineHeight:1.5, whiteSpace:"pre-wrap"}}>{na.draft_email_body}</div>
                </div>}
                <div style={{fontSize:8, color:"var(--dim)", marginTop:8, lineHeight:1.4}}>{na.disclaimer}</div>
              </div>)}
              {!na && !naLoading && <div style={{fontSize:10, color:"var(--muted)", marginTop:6}}>Get an AI recommendation for the best next step with this client, with ready-to-send drafts.</div>}
            </div>

            {/* AI Meeting Prep */}
            <div style={{marginTop:12, border:"1px solid #bee3f8", background:"#f0f9ff", borderRadius:10, padding:14}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <div style={{fontSize:12, fontWeight:700, color:"#2b6cb0"}}>📋 Meeting Prep</div>
                {!mp && <button className="btn-primary" disabled={mpLoading} style={{fontSize:10, padding:"5px 11px", opacity:mpLoading?.6:1}} onClick={runMeetingPrep}>{mpLoading?"Preparing…":"Generate"}</button>}
              </div>
              {mp && (<div style={{marginTop:10}}>
                <div style={{fontSize:11, color:"var(--text)", lineHeight:1.5, marginBottom:10, fontWeight:500}}>{mp.summary}</div>
                {[["Key facts","key_facts"],["Coverage gaps","coverage_gaps"],["Talking points","talking_points"],["Topics to explore","suggested_topics"],["Questions to ask","questions_to_ask"]].map(([label,key])=>(
                  (mp[key]&&mp[key].length>0) ? (
                    <div key={key} style={{marginBottom:8}}>
                      <div style={{fontSize:9, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", marginBottom:3}}>{label}</div>
                      <ul style={{margin:0, paddingLeft:16}}>
                        {mp[key].map((x,i)=><li key={i} style={{fontSize:11, color:"var(--text)", lineHeight:1.5, marginBottom:2}}>{x}</li>)}
                      </ul>
                    </div>
                  ) : null
                ))}
                <div style={{display:"flex", gap:6, marginTop:6}}>
                  <button className="btn-secondary" style={{fontSize:9, padding:"3px 8px"}} onClick={()=>{const txt=`Meeting prep — ${c.first_name} ${c.last_name}\n\n${mp.summary}\n\nKey facts:\n${(mp.key_facts||[]).map(x=>"• "+x).join("\n")}\n\nCoverage gaps:\n${(mp.coverage_gaps||[]).map(x=>"• "+x).join("\n")}\n\nTalking points:\n${(mp.talking_points||[]).map(x=>"• "+x).join("\n")}\n\nTopics:\n${(mp.suggested_topics||[]).map(x=>"• "+x).join("\n")}\n\nQuestions:\n${(mp.questions_to_ask||[]).map(x=>"• "+x).join("\n")}`; copy(txt,"Meeting prep");}}>Copy sheet</button>
                </div>
                <div style={{fontSize:8, color:"var(--dim)", marginTop:8, lineHeight:1.4}}>{mp.disclaimer}</div>
              </div>)}
              {!mp && !mpLoading && <div style={{fontSize:10, color:"var(--muted)", marginTop:6}}>Generate a pre-appointment one-pager: key facts, gaps, talking points, and questions.</div>}
            </div>

            {/* Follow-ups */}
            <div style={sec}>Follow-Ups {tasks.length>0?`(${tasks.length})`:""}</div>
            <div style={{background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden"}}>
              <div style={{display:"flex", gap:8, padding:10, borderBottom:tasks.length?"1px solid var(--border)":"none"}}>
                <input value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addTask();}} placeholder="Add a follow-up for this client…"
                  style={{flex:1, padding:"7px 9px", border:"1px solid var(--border)", borderRadius:6, fontSize:11, fontFamily:"DM Sans,sans-serif"}}/>
                <button className="btn-primary" style={{fontSize:11, padding:"7px 12px"}} onClick={addTask}>+ Add</button>
              </div>
              {tasks.map(t=>(
                <div key={t.task_id} style={{display:"grid", gridTemplateColumns:"auto 1fr auto", gap:9, alignItems:"center", padding:"8px 12px", borderBottom:"1px solid var(--border)"}}>
                  <input type="checkbox" onChange={()=>completeTask(t.task_id)} style={{width:15,height:15,cursor:"pointer"}}/>
                  <div style={{fontSize:11, fontWeight:500}}>{t.title}</div>
                  <div style={{fontSize:9, color:"var(--muted)"}}>{t.due_date||""}</div>
                </div>
              ))}
            </div>

            {/* Documents */}
            <div style={sec}>Documents {docs.length>0?`(${docs.length})`:""}</div>
            <div style={{background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden"}}>
              <div style={{padding:10, borderBottom:docs.length?"1px solid var(--border)":"none"}}>
                <label className="btn-secondary" style={{fontSize:11, padding:"7px 12px", cursor:docBusy?"default":"pointer", display:"inline-block", opacity:docBusy?.6:1}}>
                  {docBusy?"Uploading…":"⬆ Upload document"}
                  <input type="file" style={{display:"none"}} disabled={docBusy} onChange={e=>uploadDoc(e.target.files)}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls,.doc,.docx,.txt"/>
                </label>
              </div>
              {docs.map(d=>(
                <div key={d.doc_id} style={{display:"grid", gridTemplateColumns:"1fr auto", gap:9, alignItems:"center", padding:"8px 12px", borderBottom:"1px solid var(--border)"}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:11, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{d.filename}</div>
                    <div style={{fontSize:9, color:"var(--muted)"}}>{d.size_bytes?`${(d.size_bytes/1024).toFixed(0)} KB · `:""}{new Date(d.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                  </div>
                  {d.url && <a className="btn-secondary" href={d.url} target="_blank" rel="noreferrer" style={{fontSize:9, padding:"3px 9px", textDecoration:"none"}}>Open</a>}
                </div>
              ))}
            </div>

            {/* Overview */}
            <div style={sec}>Overview</div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:14}}>
              {chip("Age", c.age)}
              {chip("Marital", c.marital_status)}
              {chip("Dependents", c.dependents)}
              {chip("Location", [c.city, c.state].filter(Boolean).join(", "))}
              {chip("Source", c.source)}
              {chip("Client since", date(c.created_at))}
              {chip("SMS consent", c.consent_sms?"✓ Yes":"No")}
              {chip("Email consent", c.consent_email?"✓ Yes":"No")}
              {chip("Policies", c.policy_count)}
            </div>

            {/* Scores */}
            {data.scores && <>
              <div style={sec}>Priority Scores</div>
              <div style={{background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:14, display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10}}>
                {[["Priority",data.scores.priority_score],["Pipeline",data.scores.primary_pipeline],["Conversion",data.scores.conversion_score],["OPRA",data.scores.opra_score],["Life",data.scores.life_score],["Retirement",data.scores.retirement_score]].map((s,i)=>(
                  <div key={i}>{chip(s[0], s[1])}</div>
                ))}
              </div>
            </>}

            {/* Policies */}
            <div style={sec}>Policies ({data.policies.length})</div>
            {data.policies.length===0 ? <div style={{fontSize:11, color:"var(--muted)"}}>No policies on record.</div> :
              <div style={{background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden"}}>
                {data.policies.map((p,i)=>(
                  <div key={i} style={{display:"grid", gridTemplateColumns:"1fr auto", gap:8, padding:"10px 12px", borderBottom:"1px solid var(--border)"}}>
                    <div><div style={{fontSize:12, fontWeight:600, textTransform:"capitalize"}}>{p.policy_type} · {p.carrier||"—"}</div>
                      <div style={{fontSize:10, color:"var(--muted)"}}>{p.status}{p.conversion_deadline?` · conv. deadline ${date(p.conversion_deadline)}`:""}</div></div>
                    <div style={{textAlign:"right", fontSize:11, fontWeight:600}}>{money(p.annual_premium)}<div style={{fontSize:8, color:"var(--muted)", fontWeight:400}}>/yr</div></div>
                  </div>
                ))}
              </div>}

            {/* Cases */}
            {data.cases.length>0 && <>
              <div style={sec}>Commission Cases ({data.cases.length})</div>
              <div style={{background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden"}}>
                {data.cases.map((k,i)=>(
                  <div key={i} style={{display:"grid", gridTemplateColumns:"1fr auto", gap:8, padding:"10px 12px", borderBottom:"1px solid var(--border)"}}>
                    <div><div style={{fontSize:12, fontWeight:600}}>{k.product_name}</div>
                      <div style={{fontSize:10, color:"var(--muted)"}}>{k.carrier} · {k.case_status}</div></div>
                    <div style={{textAlign:"right", fontSize:11, fontWeight:600, color:"var(--green2)"}}>{money(k.estimated_gdc)}<div style={{fontSize:8, color:"var(--muted)", fontWeight:400}}>est. GDC</div></div>
                  </div>
                ))}
              </div>
            </>}

            {/* Activity */}
            <div style={sec}>Activity Timeline</div>
            {data.activity.length===0 ? <div style={{fontSize:11, color:"var(--muted)"}}>No activity logged yet.</div> :
              <div style={{borderLeft:"2px solid var(--border)", marginLeft:6, paddingLeft:14}}>
                {data.activity.map((a,i)=>(
                  <div key={i} style={{position:"relative", paddingBottom:12}}>
                    <span style={{position:"absolute", left:-21, top:2, width:8, height:8, borderRadius:"50%", background:"#4299e1"}}/>
                    <div style={{fontSize:11, fontWeight:600, textTransform:"capitalize"}}>{a.type}{a.subject?`: ${a.subject}`:""}</div>
                    {a.notes && <div style={{fontSize:10, color:"var(--muted)", lineHeight:1.5}}>{a.notes}</div>}
                    <div style={{fontSize:9, color:"var(--dim)"}}>{new Date(a.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}{a.ai_agent?` · ${a.ai_agent}`:""}</div>
                  </div>
                ))}
              </div>}
          </>)}
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const [page,setPage]=useState("briefing");
  const [tier,setTier]=useState(3);
  const [toasts,setToasts]=useState([]);
  const [assistantOpen,setAssistantOpen]=useState(false);
  const [drawerCustomerId,setDrawerCustomerId]=useState(null);
  const toast=(msg,type="info")=>{const id=Date.now();setToasts(t=>[...t,{id,msg,type}]);setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3000);};

  // ── LIVE DATA ──────────────────────────────────────────
  const appData = useAppData();

  // Keep tier in sync with live GDC data
  useEffect(()=>{
    if(appData.gdc?.tier) setTier(appData.gdc.tier);
  },[appData.gdc?.tier]);

  const liveConvUrgent = appData.urgentConversions.filter(c=>(c.days_to_deadline??999)<=30).length;
  const liveOpraUncontacted = appData.opraDue.filter(c=>!c.contacted).length;
  const liveOpps = appData.topOpportunities.length;
  const livePendingForms = appData.counts.pending_forms;
  const syncLabel = appData.lastFetch
    ? "Synced "+appData.lastFetch.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})
    : appData.loading ? "Syncing..." : "Not synced";

  const navItems=[
    {id:"briefing",  icon:"☀️", label:"Daily Briefing"},
    {id:"dashboard", icon:"🏠", label:"Dashboard"},
    {id:"opps",      icon:"🎯", label:"Opportunities",  badge:liveOpps||null},
    {id:"agencies",  icon:"🏢", label:"Agency Owners",  badge:null, bc:"red"},
    {id:"upload",    icon:"📥", label:"Contact Upload"},
    {id:"followups", icon:"✅", label:"Follow-Ups"},
    {id:"campaigns", icon:"📣", label:"Campaigns"},
    {id:"reports",   icon:"📊", label:"Reports"},
    {id:"conv",      icon:"⏰", label:"Conversions",    badge:liveConvUrgent||null, bc:"red"},
    {id:"opra",      icon:"🔄", label:"OPRA Center",    badge:liveOpraUncontacted||null, bc:"orange"},
    {id:"calendar",  icon:"📅", label:"Calendar"},
    {id:"ai",        icon:"🤖", label:"AI Control Center"},
    {id:"workshops", icon:"🎓", label:"Workshops"},
    {id:"gdc",       icon:"💰", label:"GDC & Commission"},
    {id:"prep",      icon:"📝", label:"Review Prep"},
    {id:"needs",     icon:"🗺", label:"Needs Map"},
    {id:"calc",      icon:"📐", label:"Sales Calculator"},
    {id:"contacts",  icon:"📞", label:"FFS Contacts"},
    {id:"forms",     icon:"📋", label:"Client Forms",   badge:livePendingForms||null, bc:"orange"},
    {id:"fna",       icon:"✦",  label:"FNA Generator"},
  ];
  const sideAgents=[
    {name:"Receptionist AI",status:"online",ct:"—"},
    {name:"Appt Setter AI",status:"running",ct:"—"},
    {name:"Conversion AI",status:"running",ct:"—"},
    {name:"Follow Up AI",status:"running",ct:"—"},
  ];
  const pageTitle={briefing:"Daily Briefing",dashboard:"Dashboard",opps:"Opportunities",agencies:"Agency Owners",upload:"Contact Upload",followups:"Follow-Ups",campaigns:"Drip Campaigns",reports:"Reports & Analytics",conv:"Conversion Center",opra:"OPRA Center",calendar:"Calendar",ai:"AI Control Center",workshops:"Workshops",gdc:"GDC & Commission",prep:"Financial Review Prep",needs:"Customer Needs Map",calc:"Sales Calculator",contacts:"FFS Contacts",forms:"Client Forms",fna:"Financial Needs Analysis"};

  return(<>
    <style>{G}</style>
    <div className="shell">
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="sb-logo-top"><div className="sb-badge">M</div><div className="sb-name">Markist</div></div>
          <div className="sb-sub">FSA Command Center</div>
        </div>
        <div className="sb-sec">Navigation</div>
        {navItems.map(n=>(
          <button key={n.id} className={`nav-item${page===n.id?" active":""}`} onClick={()=>setPage(n.id)}>
            <span className="ni-icon">{n.icon}</span>{n.label}
            {n.badge&&<span className={`ni-badge${n.bc?" "+n.bc:""}`}>{n.badge}</span>}
          </button>
        ))}
        <div className="sb-sec">AI Agents</div>
        <div className="agents-box clickable" onClick={()=>setPage("ai")} role="button" tabIndex={0}
             onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setPage("ai");}} title="Open AI Control Center">
          <div className="ab-title">Live Status</div>
          {sideAgents.map((a,i)=>(<div className="agent-row" key={i}><div className={`a-dot ${a.status}`}/><div className="a-name">{a.name}</div><div className="a-ct">{a.ct}</div></div>))}
          <div style={{fontSize:8,color:"var(--dim)",marginTop:6,lineHeight:1.4}}>Counts unavailable — connect Retell/Twilio to populate.</div>
          <div className="ab-open">Open AI Control Center →</div>
        </div>
        <div className="tier-box">
          <div className="tier-label">Current GDC Tier</div>
          <div className="tier-val">{TIERS[tier-1].label} — {TIERS[tier-1].rateLabel}</div>
          <div className="tier-sub">{TIERS[tier-1].range}</div>
        </div>
        <div className="sb-sec">FFS Key Contacts</div>
        <div className="contacts-box">
          <div className="contacts-title">Quick Access</div>
          {FFS_CONTACTS.map((c,i)=>(<div className="contact-row" key={i}>
            <div className="contact-role">{c.role}</div>
            <div className="contact-name">{c.name}</div>
            <a className="contact-tel" href={"tel:"+toTel(c.tel)}>{c.tel}</a>
          </div>))}
        </div>
        <div className="sb-bottom">
          <button className="help-btn" onClick={()=>setAssistantOpen(true)}>
            <span>💬</span><div><div>Need Help?</div><div className="help-sub">Open AI Assistant</div></div>
          </button>
        </div>
      </div>
      <div className="main">
        <div className="topbar">
          <div>
            <span className="tb-title">{pageTitle[page]||"Dashboard"}</span>
            {page==="briefing"&&<span className="tb-sub"> {appData.counts?.opra_due+appData.counts?.urgent_conversions || 0} urgent items · {appData.topOpportunities?.length || 0} opportunities today</span>}
          </div>
          <TopSearch onOpenCustomer={setDrawerCustomerId} toast={toast}/>
          <div style={{position:"relative",cursor:"pointer"}} onClick={()=>toast("3 alerts: 1 flagged GDC case · 2 forms pending · 1 opt-out","info")}>
            <span style={{fontSize:18,lineHeight:1}}>🔔</span>
            <span style={{position:"absolute",top:-3,right:-4,background:"var(--red)",color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontFamily:"DM Mono,monospace"}}>3</span>
          </div>
          <div className="tb-date">
            <span>📅 {today}</span>
            <span style={{marginLeft:10,fontSize:9,color:"var(--dim)"}}>{ syncLabel}</span>
          </div>
          <button className="import-btn" onClick={()=>{appData.refresh();toast("Refreshing data...","info");}}>↻ Refresh Data</button>
        </div>
        <div className="page">
          {appData.error && (
            <div className="error-banner">
              <span>⚠ Live data failed to load ({appData.error}). Showing what's available.</span>
              <button onClick={()=>{appData.refresh();toast("Retrying…","info");}}>Retry</button>
            </div>
          )}
          {page==="briefing"   &&<DailyBriefing onNav={setPage} toast={toast} appData={appData}/>}
          {page==="dashboard"  &&<Dashboard onNav={setPage} toast={toast} appData={appData}/>}
          {page==="opps"       &&<OpportunityDashboard toast={toast} appData={appData}/>}
          {page==="conv"       &&<ConversionCenter toast={toast} appData={appData}/>}
          {page==="opra"       &&<OPRACenter toast={toast} appData={appData}/>}
          {page==="ai"         &&<AIControlCenter toast={toast}/>}
          {page==="agencies"   &&<AgencyOwners toast={toast} onNav={setPage}/>}
          {page==="upload"     &&<ContactUploadPage toast={toast}/>}
          {page==="followups"  &&<FollowUpsPage toast={toast} onOpenCustomer={setDrawerCustomerId}/>}
          {page==="campaigns"  &&<CampaignsPage toast={toast}/>}
          {page==="reports"    &&<ReportsPage toast={toast}/>}
          {page==="calendar"   &&<Calendar toast={toast} appData={appData}/>}
          {page==="workshops"  &&<WorkshopsPage toast={toast}/>}
          {page==="gdc"        &&<GDCPage tier={tier} setTier={setTier} toast={toast} appData={appData}/>}
          {page==="prep"       &&<ReviewPrepPage toast={toast} appData={appData}/>}
          {page==="needs"      &&<NeedsMapPage toast={toast}/>}
          {page==="calc"       &&<SalesCalcPage/>}
          {page==="forms"      &&<FormsPage toast={toast} onNav={setPage} appData={appData}/>}
          {page==="fna"        &&<FNAPage toast={toast} onNav={setPage}/>}
          {page==="contacts"   &&(
            <div>
              <div className="page-title">FFS Key Contacts</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                {[
                  {name:"FFS Sales Desk",role:"General support, case consultations, products training",tel:"(866) 888-9739",ext:"Option 3 → 3 (Central/TX)",hours:"Mon–Fri 7AM–5PM PT"},
                  {name:"Matt Anderson",role:"Financial Services Director — Central (TX, AZ, CO, KS, OK, MO, NM, UT)",tel:"(818) 584-0264",email:"matthew.1.anderson@farmersinsurance.com"},
                  {name:"Ando Agamalian",role:"Internal Wholesaler — Central territory",tel:"(818) 584-0205",email:"ando.agamalian@farmersinsurance.com"},
                  {name:"Ryan Anderson",role:"FFS Regional Compliance Consultant — TX/Central",tel:"(253) 242-0597",email:"ryan.anderson@farmersinsurance.com"},
                  {name:"Lora Brandt",role:"FFS Supervisory Principal Manager — OSJ New Accounts",tel:"(818) 584-0199",email:"lora.brandt@farmersinsurance.com"},
                  {name:"Commissions / Finance",role:"Commission payment questions",tel:"(866) 888-9739",ext:"Option 6",email:"usw_ffs_accounting@farmersinsurance.com"},
                  {name:"Compliance",role:"Compliance inquiries",tel:"(866) 888-9739",ext:"Option 5",email:"usw_ffs_compliance@farmersinsurance.com"},
                  {name:"Licensing & Registration",role:"Yesi Cervantes · Gloria Perez · Katherine Morales",tel:"(818) 584-0225",email:""},
                ].map((c,i)=>(
                  <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:16,boxShadow:"var(--shadow)"}}>
                    <div style={{fontWeight:600,marginBottom:4,fontSize:13}}>{c.name}</div>
                    <div style={{fontSize:10,color:"var(--muted)",marginBottom:8,lineHeight:1.5}}>{c.role}</div>
                    <a href={"tel:"+toTel(c.tel)} style={{display:"block",fontFamily:"DM Mono,monospace",fontSize:12,color:"var(--blue)",marginBottom:3,textDecoration:"none",fontWeight:600}}>📞 {c.tel}{c.ext?" — "+c.ext:""}</a>
                    {c.email&&<a href={`mailto:${c.email}`} style={{fontSize:9,color:"var(--muted)",fontFamily:"DM Mono,monospace",textDecoration:"none",display:"block"}}>{c.email}</a>}
                    {c.hours&&<div style={{fontSize:9,color:"var(--dim)",marginTop:4}}>{c.hours}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    <div className="toast-wrap">{toasts.map(t=><div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    <AssistantModal open={assistantOpen} onClose={()=>setAssistantOpen(false)}/>
    <ClientDrawer customerId={drawerCustomerId} onClose={()=>setDrawerCustomerId(null)} toast={toast}/>
  </>);
}
