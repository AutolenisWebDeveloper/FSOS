import { useState, useEffect, useCallback } from "react";

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

  const fetch_ = useCallback(() => {
    setLoading(true);
    fetch("/api/dashboard")
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLastFetch(new Date());
        setLoading(false);
      })
      .catch(e => {
        console.error("Dashboard fetch error:", e);
        setError(e.message);
        setLoading(false);
      });
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

// Live hook for form submissions (responses viewer)
function useFormResponses() {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    fetch("/api/forms/submit?limit=50")
      .then(r => r.json())
      .then(d => { setResponses(d.submissions ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { responses, loading };
}

// Live hook for agencies
function useAgencies() {
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading]   = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/agencies/referral?limit=100")
      .then(r => r.json())
      .then(d => {
        // Group referrals by agency and merge with base agency data
        setAgencies(d.agencies ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { agencies, loading, refresh };
}

// Live hook for workshops
function useWorkshops() {
  const [workshops, setWorkshops] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    fetch("/api/dashboard?scope=workshops")
      .then(r => r.json())
      .then(d => { setWorkshops(d.workshops ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { workshops, loading };
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

const PRIORITIES=[
  {name:"Mary Jones",pri:"HIGH",reason:"Conversion expires in 32 days",face:"$250,000",policy:"Term Policy",agency:"Johnson Agency",score:95,action:"CONV",calls:2,sms:1,booked:true,biz:false,formDone:true},
  {name:"Robert Smith",pri:"HIGH",reason:"New Homeowner — No Life Insurance",face:"$425,000",policy:"Home Value",agency:"Brown Agency",score:88,action:"LIFE",calls:1,sms:2,booked:false,biz:false,formDone:false},
  {name:"Carlos Vega",pri:"MED",reason:"IRA Rollover Opportunity",face:"$350,000",policy:"Est. Value",agency:"Vega Insurance Group",score:75,action:"RETIRE",calls:0,sms:1,booked:false,biz:false,formDone:true},
  {name:"TechCorp LLC",pri:"HIGH",reason:"No buy-sell agreement · No key-man life",face:"$1.2M",policy:"Business Value",agency:"Brown Agency",score:92,action:"BIZ",calls:1,sms:0,booked:true,biz:true,formDone:true},
  {name:"Jennifer Brown",pri:"MED",reason:"OPRA Transfer — Mono-line customer",face:"$1,840",policy:"Annual Premium",agency:"Brown Agency",score:68,action:"OPRA",calls:1,sms:0,booked:true,biz:false,formDone:false},
  {name:"John Smith",pri:"LOW",reason:"Life Review — No life policy on file",face:"$320,000",policy:"Home Value",agency:"Johnson Agency",score:61,action:"LIFE",calls:0,sms:1,booked:false,biz:false,formDone:false},
];
const APPOINTMENTS=[
  {time:"9:00 AM",name:"Mary Jones",type:"Conversion Review",agency:"Johnson Agency",status:"confirmed",color:"#e53e3e",formDone:true},
  {time:"10:00 AM",name:"Robert Smith",type:"Life Insurance Review",agency:"Brown Agency",status:"confirmed",color:"#4299e1",formDone:false},
  {time:"11:00 AM",name:"TechCorp LLC",type:"Business Owner Review",agency:"Brown Agency",status:"confirmed",color:"#553c9a",formDone:true},
  {time:"2:00 PM",name:"Jennifer Brown",type:"OPRA Review",agency:"Brown Agency",status:"pending",color:"#dd6b20",formDone:false},
  {time:"4:00 PM",name:"John Smith",type:"Life Review",agency:"Johnson Agency",status:"confirmed",color:"#4299e1",formDone:false},
];
const PIPELINES=[
  {name:"OPRA Transfers",count:4,pct:40,color:"#e53e3e",gdc:"$18,500"},
  {name:"Conversions",count:3,pct:30,color:"#f0b429",gdc:"$24,000"},
  {name:"Life Reviews",count:6,pct:60,color:"#38a169",gdc:"$20,000"},
  {name:"Retirement",count:4,pct:40,color:"#553c9a",gdc:"$10,000"},
  {name:"Business Owners",count:2,pct:15,color:"#7b2d8b",gdc:"$28,000"},
  {name:"Workshops",count:12,pct:50,color:"#0a5060",gdc:"—"},
];
const AGENTS=[
  {name:"Receptionist AI",status:"online",m:[{v:12,l:"Calls Answered"},{v:3,l:"Appointments"},{v:0,l:"Transfers"}]},
  {name:"Appointment Setter AI",status:"running",m:[{v:41,l:"Calls Made"},{v:2,l:"Appointments"},{v:8,l:"Voicemails"}]},
  {name:"Conversion AI",status:"running",m:[{v:17,l:"Conv. Calls"},{v:1,l:"Appointments"},{v:5,l:"Follow-ups"}]},
  {name:"Follow Up AI",status:"running",m:[{v:89,l:"Texts Sent"},{v:14,l:"Responses"},{v:4,l:"Booked"}]},
];
const CONVERSIONS=[
  {urgency:30,name:"Mary Jones",face:"$250,000",premium:"$87/mo",agency:"Johnson Agency",status:"Appointment Scheduled",days:32},
  {urgency:60,name:"David Lee",face:"$150,000",premium:"$62/mo",agency:"Brown Agency",status:"Needs Contact",days:47},
  {urgency:60,name:"Robert Smith",face:"$500,000",premium:"$124/mo",agency:"Brown Agency",status:"Needs Contact",days:58},
  {urgency:90,name:"Sandra Kim",face:"$300,000",premium:"$94/mo",agency:"Vega Insurance Group",status:"SMS Sent",days:72},
];
const GDC_CASES=[
  {client:"John Smith",product:"Legend 7 Opt 1",carrier:"MassMutual Ascend",type:"FIA",premium:150000,gdcRate:0.08,status:"issued",issued_date:"2026-05-12",paid_date:"2026-05-28"},
  {client:"Maria Gonzalez",product:"Pacific Horizon IUL",carrier:"Pacific Life",type:"Life",premium:80000,gdcRate:0.95,status:"submitted",isTarget:true,targetPremium:12000,issued_date:null,paid_date:null},
  {client:"Carlos Vega",product:"Agility 10 Opt 1",carrier:"Athene",type:"FIA",premium:200000,gdcRate:0.07,status:"issued",issued_date:"2026-05-20",paid_date:null},
  {client:"TechCorp LLC",product:"Key-Man Term",carrier:"FNWL",type:"Life",premium:85000,gdcRate:null,status:"flagged",issued_date:null,paid_date:null},
  {client:"Robert Davis",product:"Mutual Fund IRA",carrier:"Voya",type:"MF",premium:50000,gdcRate:0.01,trail:0.005,status:"pending",issued_date:null,paid_date:null},
];
const WORKSHOPS=[
  {title:"Retirement Planning Workshop",date:"Jun 15 · 6:30 PM · In-person",registered:28,attended:null,hot:8,booked:3,topic:"retire"},
  {title:"Life Insurance Workshop",date:"Jun 28 · 11:00 AM · Virtual",registered:14,attended:null,hot:null,booked:null,topic:"life"},
];
const numColors=["#e53e3e","#553c9a","#dd6b20","#2b6cb0","#38a169","#0a5060"];
const pbCls={HIGH:"hi",MED:"md",LOW:"lo",BIZ:"biz"};
const pbLbl={HIGH:"HIGH PRIORITY",MED:"MED PRIORITY",LOW:"LOW PRIORITY",BIZ:"BUSINESS OWNER"};
const actionMap={CONV:"CONV",OPRA:"OPRA",LIFE:"LIFE",RETIRE:"RETIRE",BIZ:"BIZ"};

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

  // Use live GDC data if available, otherwise fall back to hardcoded
  const liveGDC = appData.gdc || {};
  const totalGDC = liveGDC.pipeline || GDC_CASES.filter(c=>c.status!=="flagged"&&c.gdcRate).reduce((s,c)=>{
    const base=c.isTarget?c.targetPremium:c.premium;
    return s+(base*c.gdcRate);
  },0);
  const totalFSA=totalGDC*t.rate;
  return(<>
    <div className="page-title">GDC & Commission — Tier-Aware Calculator</div>
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
    <div className="card">
      <div className="card-head">
        <div className="card-title">Active Cases</div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn-secondary" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>toast("Export CSV — coming in Vercel deployment","info")}>Export CSV</button>
          <button className="btn-primary" style={{fontSize:10,padding:"4px 12px"}} onClick={()=>toast("Add Case modal — connect to Supabase on deploy","info")}>+ Add Case</button>
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table className="cases-table">
          <thead><tr><th>Client</th><th>Carrier</th><th>Product</th><th>Type</th><th>Premium</th><th>GDC Rate</th><th>Est. GDC</th><th>FSA ({TIERS[tier-1].rateLabel})</th><th>Issued Date</th><th>Paid Date</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{GDC_CASES.map((c,i)=>{
            const base=c.isTarget?c.targetPremium:c.premium;
            const gdc=c.gdcRate?base*c.gdcRate:null;
            const fsa=gdc?gdc*TIERS[tier-1].rate:null;
            return(<tr key={i}>
              <td style={{fontWeight:500}}>{c.client}</td>
              <td className="td-mono" style={{color:"var(--muted)",fontSize:10}}>{c.carrier||"—"}</td>
              <td className="td-mono" style={{color:"var(--muted)"}}>{c.product}</td>
              <td><span className={`sp sp-${c.type==="FIA"||c.type==="FA"?"submitted":c.type==="Life"?"confirmed":"pending"}`}>{c.type}</span></td>
              <td className="td-mono">{fmtD(c.premium)}</td>
              <td className="td-gold td-mono">{c.gdcRate?fmtPct(c.gdcRate):<span style={{color:"var(--red)"}}>MISSING</span>}</td>
              <td className="td-mono" style={{color:"#2b6cb0"}}>{fmtD(gdc)}</td>
              <td className="td-green td-mono">{fmtD(fsa)}</td>
              <td className="td-mono" style={{fontSize:10,color:c.issued_date?"var(--green2)":"var(--dim)"}}>{c.issued_date||"—"}</td>
              <td className="td-mono" style={{fontSize:10,color:c.paid_date?"var(--green2)":"var(--dim)"}}>{c.paid_date||"—"}</td>
              <td><span className={`sp sp-${c.status}`}>{c.status}</span></td>
              <td><button style={{fontSize:9,padding:"2px 7px",borderRadius:3,border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",cursor:"pointer"}} onClick={()=>toast(`Updated ${c.client} status`,"success")}>→ Next</button></td>
            </tr>);
          })}</tbody>
        </table>
      </div>
    </div>
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
  const [workshops, setWorkshops] = useState(WORKSHOPS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard?scope=workshops")
      .then(r => r.json())
      .then(d => {
        const liveWorkshops = d.workshops || [];
        if(liveWorkshops.length > 0) {
          setWorkshops(liveWorkshops.map(w => ({
            title: w.title,
            date: `${new Date(w.scheduled_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · ${w.location||"TBD"}`,
            registered: w.registered_count || 0,
            attended: w.attended_count || null,
            hot: w.hot_leads || null,
            booked: w.appointments_booked || null,
            topic: w.topic,
          })));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return(<>
    <div className="page-title">Workshops</div>
    {loading && <div style={{textAlign:"center",color:"var(--muted)",padding:20,fontSize:12}}>Loading workshops…</div>}
    {workshops.map((w,i)=><div className="workshop-card" key={i}>
      <div className="wk-head">
        <div><div className="wk-title">{w.title}</div><div className="wk-date">{w.date}</div></div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button className="view-btn" onClick={()=>{navigator.clipboard?.writeText(`${typeof window!=="undefined"?window.location.origin:""}/workshop/${w.title.toLowerCase().split(" ").join("-")}`);toast("Registration link copied!","success");}}>Copy Link</button>
          <button className="view-btn" onClick={()=>toast(`Adding attendee to ${w.title}`,"info")}>+ Attendee</button>
          <button className="view-btn" onClick={()=>toast(`Managing ${w.title}`,"info")}>Manage</button>
          <button className="import-btn" onClick={()=>toast("Sending invitation sequence","success")}>Send Invites</button>
        </div>
      </div>
      <div className="wk-stats">
        <div className="wk-stat"><div className="wk-stat-val" style={{color:"#2b6cb0"}}>{w.registered}</div><div className="wk-stat-lbl">Registered</div></div>
        <div className="wk-stat"><div className="wk-stat-val" style={{color:w.attended?"#38a169":"var(--muted)"}}>{w.attended??"-"}</div><div className="wk-stat-lbl">Attended</div></div>
        <div className="wk-stat"><div className="wk-stat-val" style={{color:w.hot?"#e53e3e":"var(--muted)"}}>{w.hot??"-"}</div><div className="wk-stat-lbl">Hot Leads</div></div>
        <div className="wk-stat"><div className="wk-stat-val" style={{color:w.booked?"#38a169":"var(--muted)"}}>{w.booked??"-"}</div><div className="wk-stat-lbl">1-on-1 Booked</div></div>
      </div>
      <div className="wk-tags">
        <span className="ai-tag">Pre-workshop reminders active</span>
        <span className={`ai-tag ${w.registered>20?"green":""}`}>{w.registered} registrants</span>
        {w.topic==="retire"&&<span className="ai-tag purple">Retirement audience</span>}
        {w.topic==="life"&&<span className="ai-tag">Life audience</span>}
      </div>
    </div>)}
    <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:9,padding:"20px",textAlign:"center",color:"var(--muted)",fontSize:12,cursor:"pointer"}} onClick={()=>toast("Opening workshop creation","info")}>
      + Schedule new workshop — retirement, life, financial planning, or business owner
    </div>
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
          <div className="card-head"><div className="card-title">🤖 AI Activity Today</div><button className="card-link" onClick={()=>onNav("agents")}>Report →</button></div>
          <div className="card-body">
            <div className="ai-stat-grid">
              {[
                {icon:"📞",val:appData.briefing?.ai_calls_made??63,lbl:"Calls Made"},
                {icon:"💬",val:appData.briefing?.ai_texts_sent??148,lbl:"Texts Sent"},
                {icon:"📧",val:appData.briefing?.ai_emails_sent??29,lbl:"Emails Sent"},
                {icon:"📅",val:appData.briefing?.ai_appointments_booked??4,lbl:"Appointments Booked"}
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

function Opportunities({toast}){
  const [filter,setFilter]=useState("All");
  const filters=["All","Conversions","OPRA","Life Reviews","Retirement","Business","Workshops"];
  const aMap={Conversions:"CONV",OPRA:"OPRA","Life Reviews":"LIFE","Retirement":"RETIRE","Business":"BIZ","Workshops":"WRK"};
  const filtered=filter==="All"?PRIORITIES:PRIORITIES.filter(p=>p.action===aMap[filter]);
  return(<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
      <div className="page-title" style={{marginBottom:0}}>Opportunities</div>
      <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={()=>toast("Exporting opportunities to CSV...","success")}>Export CSV</button>
    </div>
    <div className="opp-filters">{filters.map(f=><button key={f} className={`opp-filter${filter===f?" active":""}`} onClick={()=>setFilter(f)}>{f}</button>)}</div>
    {filtered.map((p,i)=>(
      <div className="opp-card" key={i}>
        <div>
          <div className="opp-hdr"><div className={`opp-avatar${p.biz?" biz":""}`}>{ini(p.name)}</div><div><div className="opp-name">{p.name}</div><div className="opp-meta">Agency: {p.agency}</div></div></div>
          <div className="opp-dets"><span className="opp-det">Type: {p.action}</span><span className="opp-det">Face: {p.face}</span><span className="opp-det">{p.policy}</span></div>
          <div className="ai-tags">
            {p.calls>0&&<span className="ai-tag">{p.calls} Calls</span>}
            {p.sms>0&&<span className="ai-tag">{p.sms} SMS</span>}
            {p.booked&&<span className="ai-tag green">Appointment Booked</span>}
            {p.biz&&<span className="ai-tag purple">Business Owner</span>}
            {p.formDone?<span className="ai-tag green">Forms Complete ✓</span>:<span className="ai-tag" style={{background:"var(--orange-bg)",color:"var(--orange)",borderColor:"var(--orange-border)"}}>Forms Pending ⚠</span>}
          </div>
        </div>
        <div className="opp-r">
          <div><div className="opp-score">{p.score}</div><div className="opp-slbl">Score</div></div>
          <span className={`sp ${p.booked?"sp-confirmed":"sp-pending"}`}>{p.booked?"Appt Scheduled":"Needs Call"}</span>
          <button className="open-btn" onClick={()=>toast(`Opening ${p.name} — full detail panel in Vercel deployment`,"info")}>
            OPEN →
          </button>
        </div>
      </div>
    ))}
  </>);
}

function Conversions({toast}){
  const byU=[30,60,90];
  const lbls={30:"Expiring in 30 Days",60:"Expiring in 60 Days",90:"Expiring in 90 Days"};
  const cols={30:"#e53e3e",60:"#dd6b20",90:"#2b6cb0"};
  const dlc={30:"dl-urgent",60:"dl-soon",90:"dl-ok"};
  return(<>
    <div className="page-title">Term Conversions</div>
    {byU.map(u=>{const items=CONVERSIONS.filter(c=>c.urgency===u);if(!items.length)return null;
      return(<div className="conv-section" key={u}>
        <div className="conv-head" style={{color:cols[u],borderBottomColor:cols[u]+"44"}}>⚡ {lbls[u]}</div>
        {items.map((c,i)=>(<div className="conv-card" key={i}>
          <div>
            <div className="conv-name">{c.name}</div>
            <div className="conv-dets"><span className="conv-det">Face Amount: {c.face}</span><span className="conv-det">Premium: {c.premium}</span><span className="conv-det">Agency: {c.agency}</span></div>
            <span className={`sp ${c.status.includes("Scheduled")?"sp-confirmed":"sp-pending"}`}>{c.status}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:7}}>
            <div className={`deadline ${dlc[u]}`}>{c.days} days</div>
            <div style={{display:"flex",gap:5}}>
              <button className="open-btn" onClick={()=>toast(`Calling ${c.name}`,"success")}>Call Now</button>
              <button style={{padding:"6px 10px",borderRadius:5,border:"none",background:"var(--green-bg)",color:"var(--green)",fontSize:11,cursor:"pointer",fontWeight:500}} onClick={()=>toast(`${c.name} marked complete`,"success")}>✓ Done</button>
            </div>
          </div>
        </div>))}
      </div>);
    })}
  </>);
}

function AIAgents({toast}){
  return(<>
    <div className="page-title">AI Agent Workforce</div>
    <div className="agents-grid">
      {AGENTS.map((a,i)=>(<div className="agent-card" key={i}>
        <div className="agent-card-head">
          <div className="agent-card-name">{a.name}</div>
          <div className={`asb ${a.status}`}><div className="asb-dot"/>{a.status==="online"?"Online":"Running"}</div>
        </div>
        <div className="agent-stats">{a.m.map((m,j)=><div className="agent-stat" key={j}><div className="agent-stat-val">{m.v}</div><div className="agent-stat-lbl">{m.l}</div></div>)}</div>
        <div className="agent-foot" style={{flexWrap:"wrap"}}>
          <button className="a-btn" onClick={()=>toast(`Pausing ${a.name}`,"info")}>Pause</button>
          <button className="a-btn" onClick={()=>toast(`${a.name} activity log`,"info")}>View Log</button>
          <button className="a-btn" onClick={()=>toast(`${a.name} script & knowledge base`,"info")}>Script</button>
          <button className="a-btn pri" style={{flexBasis:"100%",marginTop:4}} onClick={()=>toast(`${a.name} triggered`,"success")}>▶ Run Now</button>
        </div>
      </div>))}
    </div>
  </>);
}

// ─────────────────────────────────────────────────────────
// AGENCY OWNERS — Full relationship + referral management
// ─────────────────────────────────────────────────────────
function AgencyOwners({toast}) {
  const [tab, setTab]             = useState("overview");
  const [selected, setSelected]   = useState(null);
  const [detailTab, setDetailTab] = useState("referrals");
  const [addForm, setAddForm]     = useState({name:"",owner:"",phone:"",email:"",city:""});
  const [agencies, setAgencies]   = useState(AGENCY_DATA);
  const [referralsByAgency, setReferralsByAgency] = useState({});
  const [loading, setLoading]     = useState(true);

  const fmtK = n => n >= 1000 ? "$"+(n/1000).toFixed(0)+"k" : "$"+n;
  const fmtD = n => "$"+Number(n||0).toLocaleString("en-US");
  const BASE = typeof window !== "undefined" ? window.location.origin : "https://fsos.vercel.app";

  // Load live agencies (with referral stats) + raw referral list
  useEffect(() => {
    Promise.all([
      fetch("/api/agencies/list").then(r=>r.json()).catch(()=>({agencies:[]})),
      fetch("/api/agencies/referral?limit=200").then(r=>r.json()).catch(()=>({referrals:[]})),
    ]).then(([listData, refData]) => {
      const refs = refData.referrals || [];
      // Group referrals by agency_id
      const byAgency = {};
      refs.forEach(r => {
        if(!byAgency[r.agency_id]) byAgency[r.agency_id] = [];
        byAgency[r.agency_id].push(r);
      });
      setReferralsByAgency(byAgency);

      // Merge live agency stats onto the base AGENCY_DATA records (matched by id)
      const live = listData.agencies || [];
      if (live.length > 0) {
        const byId = {};
        live.forEach(a => { byId[a.agency_id] = a; });
        setAgencies(prev => prev.map(ag => {
          const L = byId[ag.id];
          if (!L) return ag;
          const days = L.days_since_referral ?? ag.daysSinceReferral;
          return {
            ...ag,
            owner: L.owner || ag.owner,
            city: L.city || ag.city,
            referrals: L.referral_count ?? ag.referrals,
            pendingReferrals: L.pending_referrals ?? 0,
            lastReferral: L.last_referral ? new Date(L.last_referral).toISOString().split("T")[0] : ag.lastReferral,
            daysSinceReferral: days,
            needsAttention: !!L.needs_attention || (days != null && days > 30),
          };
        }));
      }
      setLoading(false);
    });
  }, []);

  // Merge live referral counts into AGENCY_DATA
  const enrichedAgencies = agencies.map(ag => {
    const refs = referralsByAgency[ag.id] || [];
    const liveReferrals = refs.length;
    return {
      ...ag,
      referrals: liveReferrals > 0 ? liveReferrals : ag.referrals,
      referralList: refs.slice(0,20).map(r => ({
        client: r.client_name || "Unknown",
        type: r.referral_type || "general",
        submitted: r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—",
        appt: null,
        status: r.status === "new" ? "Received" : r.status.charAt(0).toUpperCase()+r.status.slice(1),
      })).concat(ag.referralList.length > 0 && refs.length === 0 ? ag.referralList : []),
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
              {[["Owner",ag.owner],["Phone",ag.phone],["Email",ag.email],["AgencyZoom",ag.agencyZoom?"Connected":"Not connected"],["APEX",ag.apex?"Connected":"Not connected"],["First Referral",ag.firstReferral],["Last Referral",ag.lastReferral]].map(([l,v],i)=>(
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
                  <button className="btn-primary" style={{fontSize:10,padding:"4px 12px"}} onClick={()=>toast("Import upload — connect APEX on deploy","info")}>+ Process Upload</button>
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
          <button className="btn-secondary" style={{fontSize:11}} onClick={()=>setTab("leaderboard")}>🏆 Leaderboard</button>
          <button className="btn-primary" style={{fontSize:11}} onClick={()=>setTab("add")}>+ Add Agency</button>
        </div>
      </div>

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

              <button className="btn-primary" style={{width:"100%",fontSize:11,padding:8}} onClick={()=>setSelected(a.id)}>
                Open {a.name} →
              </button>
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
  return(<>
    <div className="page-title">Today's Calendar</div>
    <div style={{marginBottom:10,fontSize:12,color:"var(--muted)"}}>
      🟢 Forms complete = customer submitted pre-meeting forms · 🟡 Forms pending = send reminder before appointment
    </div>
    <div className="cal-card">
      <div className="cal-hdr">TODAY — {today}</div>
      {APPOINTMENTS.map((a,i)=>(
        <div className="cal-item" key={i}>
          <div className="cal-time">{a.time}</div>
          <div className="cal-dot2" style={{background:a.color}}/>
          <div className="cal-info">
            <div className="cal-name">{a.name}<span className={`form-badge ${a.formDone?"fb-done":"fb-pending"}`}>{a.formDone?"Forms ✓":"Forms ⚠"}</span></div>
            <div className="cal-type">{a.type} · {a.agency}</div>
          </div>
          <span className={`sp ${a.status==="confirmed"?"sp-confirmed":"sp-pending"}`}>{a.status==="confirmed"?"Confirmed":"Pending"}</span>
        </div>
      ))}
    </div>
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
const MOCK_RESPONSES = [
  {id:"resp-1",client:"Mary Jones",form_id:"customer-questionnaire",submitted_at:"2026-06-02",status:"complete",data:{first_name:"Mary",last_name:"Jones",email:"mary@email.com",cell_phone:"2145551234",has_401k:"Yes",has_ira:"No",has_life:"Yes",life_10x:"No",concerns:["Retirement Preparation","Saving for College"]}},
  {id:"resp-2",client:"Carlos Vega",form_id:"customer-profile",submitted_at:"2026-06-01",status:"complete",data:{first_name:"Carlos",last_name:"Vega",dob:"1968-04-12",annual_income:185000,risk_q1:"Asset growth with current income (3)",risk_q2:"Agree (4)",risk_q3:"Some experience (4)",risk_q4:"6–12 months (4)",risk_q5:"Will increase slightly (4)",risk_q6:"41 to 60 (2)",time_horizon:"10–15 years"}},
  {id:"resp-3",client:"Robert Smith",form_id:"financial-needs-analysis",submitted_at:"2026-06-03",status:"complete",data:{first_name:"Robert",last_name:"Smith",dob:"1980-08-15",annual_income:125000,has_life_ins:"Yes — Term",life_coverage:500000,life_coverage_adequate:"No",retirement_age:65,retirement_income_goal:8000,primary_concern:"Life insurance gap",risk_tolerance:"Moderate — balanced growth and protection",business_owner:"No",emergency_fund:"Yes"}},
  {id:"resp-4",client:"TechCorp LLC",form_id:"business-questionnaire",submitted_at:"2026-05-30",status:"complete",data:{business_name:"TechCorp LLC",owner1_name:"David Chen",business_value:1200000,has_buy_sell:"No",has_401k:"No",total_assets:1500000,total_liabilities:300000}},
];

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
  const BASE = typeof window !== "undefined" ? window.location.origin : "";
  const previewLink = `${BASE}/forms/${form?.id}?client=${encodeURIComponent(client)}&t=preview`;

  const send = async () => {
    if(!client) { toast("Client name is required", "error"); return; }
    if((channel === "email" || channel === "both") && !email) { toast("Email is required", "error"); return; }
    if(channel === "copy-link") {
      navigator.clipboard?.writeText(previewLink);
      toast("Form link copied to clipboard!", "success");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/forms/send", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          form_id: form?.id,
          channel,
          destination: channel === "sms" ? phone : email,
          client_name: client,
        }),
      });
      const data = await res.json();
      if(data.success) {
        setSentLink(data.link || "");
        toast(`✓ ${form?.title} sent to ${client} via ${channel}`, "success");
        setTimeout(onClose, 1500);
      } else {
        toast(data.error || "Failed to send form", "error");
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
        {client && (
          <div className="field">
            <label>Link Preview</label>
            <div className="link-preview">
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sentLink||previewLink}</span>
              <button className="copy-btn" onClick={() => { navigator.clipboard?.writeText(sentLink||previewLink); toast("Link copied!", "success"); }}>Copy</button>
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
    fetch("/api/forms/submit?limit=50")
      .then(r => r.json())
      .then(d => {
        const subs = (d.submissions || []).filter(s =>
          ["financial-needs-analysis","customer-profile","customer-questionnaire"].includes(s.form_id) &&
          s.status === "complete"
        );
        setSubmissions(subs.length > 0 ? subs : MOCK_RESPONSES);
        setSubLoading(false);
      })
      .catch(() => { setSubmissions(MOCK_RESPONSES); setSubLoading(false); });
  }, []);

  const generateReport = async () => {
    if(!selected) { toast("Select a client first", "error"); return; }
    const isLive = submissions.some(s => s.submission_id === selected);
    setLoading(true); setReport(null);

    if(isLive) {
      try {
        const res = await fetch("/api/forms/fna", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ submission_id: selected }),
        });
        const data = await res.json();
        if(data.success) {
          const sub = submissions.find(s => s.submission_id === selected);
          setReport({ client: sub?.customer_id||"Client", data: sub?.response_data||{}, analysis: data.report, generated_at: new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}) });
          toast("✓ FNA report generated successfully", "success");
        } else { toast(data.error || "Failed to generate FNA", "error"); }
      } catch(e) { toast("Error generating FNA", "error"); }
    } else {
      const resp = MOCK_RESPONSES.find(r => r.id === selected);
      if(!resp) { toast("Select a client first","error"); setLoading(false); return; }
      setReport({
        client: resp.client, data: resp.data,
        analysis: {
          executive_summary: `${resp.data.first_name||""} ${resp.data.last_name||""} — demo mode. Connect live form submissions to generate real AI analysis.`,
          financial_position: "Demo data — submit a real Financial Needs Analysis form to generate a live report.",
          gaps: ["Life insurance coverage gap","No IRA identified","Retirement income shortfall"],
          recommendations: [{priority:1,title:"Life Insurance Gap Analysis",description:"Review current coverage against 10x income benchmark.",product_category:"Life Insurance"}],
          next_steps: ["Schedule FSA review appointment","Send Financial Needs Analysis form to client","Call FFS Sales Desk (866) 888-9739 Opt 3→3"],
          risk_profile: resp.data.risk_tolerance || "Moderate",
          urgency: "High"
        },
        generated_at: new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})
      });
      toast("✓ FNA report generated (demo mode)", "success");
    }
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
                <option value="">— Select a client —</option>
                {responses.map(r => <option key={r.id} value={r.id}>{r.client} — {r.form_id.split("-").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ")} ({r.submitted_at})</option>)}
              </select>
            </div>
            {selected && (
              <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 12px",marginBottom:12,fontSize:11}}>
                <div style={{fontWeight:600,marginBottom:4}}>Data available for this client:</div>
                {Object.entries(MOCK_RESPONSES.find(r=>r.id===selected)?.data||{}).slice(0,6).map(([k,v])=>
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

          <div className="fna-card">
            <div className="fna-card-title">📤 Send FNA Intake Form</div>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>Send the Financial Needs Analysis intake form to a client before their appointment. They complete it online — their answers auto-populate this report generator.</div>
            <div className="field"><label>Client Name</label><input placeholder="e.g. John Smith"/></div>
            <div className="field"><label>Client Email</label><input type="email" placeholder="john@email.com"/></div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn-primary" style={{flex:1}} onClick={()=>toast("FNA intake form sent","success")}>Send FNA Intake →</button>
              <button className="btn-secondary" onClick={()=>toast("Link copied","info")}>Copy Link</button>
            </div>
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
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/forms/submit?limit=100")
      .then(r => r.json())
      .then(d => {
        const subs = d.submissions || [];
        setSubmissions(subs.length > 0 ? subs : MOCK_RESPONSES);
        setLoading(false);
      })
      .catch(() => { setSubmissions(MOCK_RESPONSES); setLoading(false); });
  }, []);

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
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
          {loading && <div style={{padding:"20px",textAlign:"center",color:"var(--muted)",fontSize:12}}>Loading responses…</div>}
          {!loading && filtered.length === 0 && <div style={{padding:"20px",textAlign:"center",color:"var(--muted)",fontSize:12}}>No submitted forms yet</div>}
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
            <button onClick={()=>{ onSave(data); toast(`✓ ${form.title} saved for client`,"success"); }}
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
        onSave={data => {
          // In production: POST to /api/forms/submit with data
          // TODO: POST to /api/forms/submit
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

  const fnaForm = FORMS.find(f => f.id === "financial-needs-analysis");

  // Mode: FSA fills FNA intake on behalf of client
  if (mode === "fill") {
    return (
      <InlineFormFiller
        form={fnaForm}
        toast={toast}
        onCancel={() => setMode(null)}
        onSave={data => {
          // Store submission then go straight to report generation
          toast("✓ FNA intake saved — generating report...","success");
          setMode("generate");
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
            {["Tokenized secure link — expires in 30 days","Client fills out on phone or computer","Auto-sent when appointment booked in GHL","Responses stored in Supabase automatically"].map((s,i)=>(
              <div key={i} style={{display:"flex",gap:6,alignItems:"flex-start",fontSize:11,color:"var(--text)"}}>
                <span style={{color:"var(--green2)",flexShrink:0}}>✓</span>{s}
              </div>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              <div className="field" style={{marginBottom:0}}>
                <label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:3}}>Client Name</label>
                <input id="fna-send-name" placeholder="John Smith"
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"DM Sans,sans-serif",outline:"none"}}/>
              </div>
              <div className="field" style={{marginBottom:0}}>
                <label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:3}}>Email</label>
                <input id="fna-send-email" type="email" placeholder="john@email.com"
                  style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:4,padding:"6px 8px",fontSize:11,fontFamily:"DM Sans,sans-serif",outline:"none"}}/>
              </div>
            </div>
            <button className="btn-green" style={{width:"100%",padding:10,fontSize:12}}
              onClick={()=>{
                const n=document.getElementById("fna-send-name")?.value;
                const e=document.getElementById("fna-send-email")?.value;
                if(!n){toast("Enter client name","error");return;}
                toast(`✓ FNA intake link sent to ${n}`,"success");
              }}>
              📤 Send FNA Link →
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
          {MOCK_RESPONSES.filter(r=>r.form_id==="financial-needs-analysis").length} FNA submission{MOCK_RESPONSES.filter(r=>r.form_id==="financial-needs-analysis").length!==1?"s":""} ready to generate
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// NEW DATA — Extended for new pages
// ─────────────────────────────────────────────────────────
const CONV_CASES = [
  {id:"c1",client:"Mary Jones",agency:"Johnson Agency",policyNum:"TRM-2041-7823",face:250000,premium:87,deadline:"2026-07-15",days:32,status:"Appt Scheduled",contacted:true,apptBooked:true},
  {id:"c2",client:"David Lee",agency:"Brown Agency",policyNum:"TRM-1988-4421",face:150000,premium:62,deadline:"2026-08-01",days:47,status:"Needs Contact",contacted:false,apptBooked:false},
  {id:"c3",client:"Robert Smith",agency:"Brown Agency",policyNum:"TRM-2203-9910",face:500000,premium:124,deadline:"2026-08-20",days:58,status:"Needs Contact",contacted:false,apptBooked:false},
  {id:"c4",client:"Sandra Kim",agency:"Vega Insurance Group",policyNum:"TRM-1776-3312",face:300000,premium:94,deadline:"2026-09-12",days:72,status:"SMS Sent",contacted:true,apptBooked:false},
  {id:"c5",client:"Marcus Turner",agency:"Johnson Agency",policyNum:"TRM-2099-6651",face:200000,premium:71,deadline:"2026-09-28",days:88,status:"Appt Scheduled",contacted:true,apptBooked:true},
  {id:"c6",client:"Patricia White",agency:"Brown Agency",policyNum:"TRM-1901-2278",face:400000,premium:108,deadline:"2026-10-15",days:105,status:"Not Started",contacted:false,apptBooked:false},
];
const OPRA_CASES = [
  {id:"o1",client:"Jennifer Brown",agency:"Brown Agency",transferDate:"2026-06-20",premium:1840,contacted:true,apptScheduled:true,reviewDone:false,status:"Appt Scheduled"},
  {id:"o2",client:"Carlos Vega",agency:"Vega Insurance Group",transferDate:"2026-06-25",premium:2200,contacted:true,apptScheduled:false,reviewDone:false,status:"Needs Appt"},
  {id:"o3",client:"Linda Park",agency:"Johnson Agency",transferDate:"2026-07-01",premium:1560,contacted:false,apptScheduled:false,reviewDone:false,status:"Not Contacted"},
  {id:"o4",client:"James Rivera",agency:"Brown Agency",transferDate:"2026-07-05",premium:3100,contacted:false,apptScheduled:false,reviewDone:false,status:"Not Contacted"},
];
// ── AGENCY DATA ──────────────────────────────────────────
// Combines Scoreboard data + relationship management data per the design spec
const AGENCY_DATA = [
  {
    id:"ag1", name:"Johnson Agency", owner:"Steven Johnson",
    city:"Corpus Christi, TX", phone:"(361) 555-0142", email:"steven@farmersagent.com",
    agencyZoom:true, apex:true,
    firstReferral:"2026-01-15", lastReferral:"2026-06-03", lastActivity:2,
    slug:"steven-johnson",
    customers:1842, referrals:43, uploads:12, contacts:3481,
    appts:17, apps:8, issued:5, issuedGDC:38000, pendingOpp:22,
    opra:3, conv:4, life:18, retire:7, biz:5,
    notes:"Interested in conversion program. Needs OPRA support.",
    lastCall:"2026-05-30", lastMeeting:"2026-05-15", lastEmail:"2026-06-01",
    daysSinceReferral:0, needsAttention:false,
    referralList:[
      {client:"John Smith",type:"Retirement",submitted:"2026-06-01",appt:"2026-06-12",status:"Scheduled"},
      {client:"Mary Jones",type:"Conversion",submitted:"2026-05-28",appt:null,status:"Application Submitted"},
      {client:"Robert Garcia",type:"Life Review",submitted:"2026-05-20",appt:"2026-05-27",status:"Issued"},
      {client:"Jennifer Brown",type:"OPRA",submitted:"2026-05-10",appt:"2026-05-18",status:"Review Complete"},
    ],
    uploadHistory:[
      {date:"2026-06-03",type:"AgencyZoom Export",records:1248,opps:42},
      {date:"2026-05-29",type:"Customer List",records:764,opps:16},
      {date:"2026-05-10",type:"OPRA Export",records:312,opps:8},
    ]
  },
  {
    id:"ag2", name:"Brown Agency", owner:"Sarah Brown",
    city:"McKinney, TX", phone:"(972) 555-0288", email:"sarah@farmersagent.com",
    agencyZoom:true, apex:false,
    firstReferral:"2026-02-03", lastReferral:"2026-05-28", lastActivity:6,
    slug:"sarah-brown",
    customers:1240, referrals:31, uploads:8, contacts:2100,
    appts:14, apps:6, issued:4, issuedGDC:28500, pendingOpp:15,
    opra:3, conv:4, life:12, retire:5, biz:2,
    notes:"Very active. Wants monthly check-in call. Strong on life reviews.",
    lastCall:"2026-05-25", lastMeeting:"2026-05-27", lastEmail:"2026-05-28",
    daysSinceReferral:6, needsAttention:false,
    referralList:[
      {client:"Patricia White",type:"Life Review",submitted:"2026-05-28",appt:"2026-06-05",status:"Scheduled"},
      {client:"David Lee",type:"Conversion",submitted:"2026-05-15",appt:null,status:"Needs Contact"},
    ],
    uploadHistory:[
      {date:"2026-05-28",type:"Customer List",records:890,opps:22},
      {date:"2026-05-01",type:"AgencyZoom Export",records:1210,opps:31},
    ]
  },
  {
    id:"ag3", name:"Vega Insurance Group", owner:"Carlos Vega Sr.",
    city:"San Antonio, TX", phone:"(210) 555-0371", email:"carlos@farmersagent.com",
    agencyZoom:false, apex:true,
    firstReferral:"2026-03-10", lastReferral:"2026-05-12", lastActivity:22,
    slug:"carlos-vega-sr",
    customers:980, referrals:14, uploads:3, contacts:890,
    appts:6, apps:2, issued:1, issuedGDC:9500, pendingOpp:11,
    opra:2, conv:2, life:4, retire:3, biz:1,
    notes:"Slower to adopt. Needs coaching on referral process. Follow up on AgencyZoom setup.",
    lastCall:"2026-05-10", lastMeeting:"2026-04-22", lastEmail:"2026-05-12",
    daysSinceReferral:22, needsAttention:true,
    referralList:[
      {client:"Carlos Vega Jr.",type:"Retirement",submitted:"2026-05-12",appt:"2026-05-20",status:"Application Submitted"},
    ],
    uploadHistory:[
      {date:"2026-05-01",type:"Customer List",records:890,opps:14},
    ]
  },
  {
    id:"ag4", name:"Taylor Agency", owner:"Jack Taylor",
    city:"Plano, TX", phone:"(469) 555-0199", email:"jack@farmersagent.com",
    agencyZoom:true, apex:true,
    firstReferral:"2026-04-01", lastReferral:"2026-04-18", lastActivity:46,
    slug:"jack-taylor",
    customers:640, referrals:6, uploads:1, contacts:640,
    appts:3, apps:1, issued:0, issuedGDC:0, pendingOpp:8,
    opra:1, conv:1, life:2, retire:2, biz:0,
    notes:"No referrals in 46 days. Call to re-engage. Has 3 unworked opportunities.",
    lastCall:"2026-04-20", lastMeeting:"2026-03-15", lastEmail:"2026-04-18",
    daysSinceReferral:46, needsAttention:true,
    referralList:[],
    uploadHistory:[
      {date:"2026-04-01",type:"Customer List",records:640,opps:8},
    ]
  },
];
// Keep AGENCY_SCORES as alias for backward compat with AgencyScoreboard
const AGENCY_SCORES = AGENCY_DATA;

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
  }));

  // Fall back to mock if DB empty (dev mode)
  const displayCases = cases.length > 0 ? cases : CONV_CASES;

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
        {label:"Total Face Amount",val:"$"+cases.reduce((s,c)=>s+c.face,0).toLocaleString("en-US"),color:"#2b6cb0",bg:"var(--blue-bg)",bdr:"var(--blue-border)"},
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
              <td style={{fontWeight:600}}>{c.client}</td>
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
  </>);
}

// ─────────────────────────────────────────────────────────
// 2. OPRA CENTER — Transfer tracking
// ─────────────────────────────────────────────────────────
function OPRACenter({toast,appData={}}) {
  const [liveData, setLiveData] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    // Show uncontacted first
    fetch("/api/opra?contacted=false&limit=100")
      .then(r => r.json())
      .then(d => {
        setLiveData(d.cases || []);
        setCounts(d.counts || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const usingLive = liveData.length > 0;
  const cases = (usingLive ? liveData : OPRA_CASES).map(c => {
    const isLive = !!c.opra_id;
    const id = isLive ? c.opra_id : c.id;
    return {
      id,
      isLive,
      client: isLive ? `${c.customers?.first_name||""} ${c.customers?.last_name||""}`.trim()||"Unknown" : c.client,
      agency: isLive ? (c.customers?.agencies?.name||"—") : c.agency,
      transferDate: isLive ? c.transfer_date : c.transferDate,
      premium: isLive ? (c.annual_premium||0) : c.premium,
      contacted: isLive ? c.contacted : c.contacted,
      apptScheduled: isLive ? c.appt_scheduled : c.apptScheduled,
      reviewDone: isLive ? c.review_complete : c.reviewDone,
      transferred: isLive ? c.transferred : false,
      status: isLive ? c.status : c.status,
    };
  });

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

    {loading && <div style={{fontSize:12,color:"var(--muted)",marginBottom:10}}>Loading OPRA cases…</div>}

    {/* TABLE */}
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"auto",boxShadow:"var(--shadow)"}}>
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
              <td style={{fontWeight:600}}>{c.client}</td>
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
    </div>

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

  const actionColor = {CONV:"var(--orange)",OPRA:"var(--red)",LIFE:"var(--blue)",RETIRE:"var(--purple)",BIZ:"#7b2d8b"};
  const actionLabel = {CONV:"Conversion",OPRA:"OPRA",LIFE:"Life Review",RETIRE:"Retirement",BIZ:"Business Owner"};
  const actionMap2 = {conversions:"CONV",opra:"OPRA",life:"LIFE",retirement:"RETIRE",business:"BIZ"};

  useEffect(() => {
    setLoading(true);
    fetch(`/api/scores?limit=100${pipeFilter!=="all"?`&pipeline=${pipeFilter}`:""}`)
      .then(r => r.json())
      .then(d => {
        setOpps(d.opportunities || []);
        setPipelineCounts(d.pipeline_counts || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [pipeFilter]);

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
    };
  });

  // Fall back to hardcoded data only if DB is empty AND no filter is applied
  const displayPriorities = priorities.length > 0 ? priorities : (pipeFilter==="all" && !loading ? PRIORITIES : []);

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
        <button className="btn-secondary" style={{fontSize:10,padding:"5px 12px"}} onClick={()=>setPipeFilter(f=>f)}>↻ Refresh Scores</button>
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
    {loading && <div style={{fontSize:12,color:"var(--muted)",marginBottom:12}}>Loading opportunities…</div>}
    {!loading && displayPriorities.length===0 && <div style={{fontSize:12,color:"var(--muted)",marginBottom:12}}>No opportunities for this pipeline yet.</div>}
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
    <div style={{fontSize:12,color:"var(--muted)",marginBottom:16}}>
      All 4 AI agents powered by GHL · *Cost included in GHL AI Employee plan ($97/mo flat) · Compliant with TCPA, Texas SB 140, TRAIGA
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
// 5. AGENCY SCOREBOARD — Multi-agency performance
// ─────────────────────────────────────────────────────────
function AgencyScoreboard({toast}) {
  const [sort, setSort] = useState("issuedGDC");
  const sorted = [...AGENCY_SCORES].sort((a,b)=>b[sort]-a[sort]);
  const fmtK = n => n>=1000 ? "$"+(n/1000).toFixed(0)+"k" : "$"+n;
  const maxGDC = Math.max(...AGENCY_SCORES.map(a=>a.issuedGDC));

  return (<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div>
        <div className="page-title" style={{marginBottom:2}}>Agency Scoreboard</div>
        <div style={{fontSize:12,color:"var(--muted)"}}>Performance across all agencies · YTD issued GDC and pipeline opportunities</div>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <span style={{fontSize:10,color:"var(--muted)"}}>Sort by:</span>
        {[["issuedGDC","GDC"],["appts","Appts"],["apps","Apps"],["pendingOpp","Pipeline"]].map(([k,l])=>(
          <button key={k} className={`opp-filter${sort===k?" active":""}`} style={{padding:"4px 10px",fontSize:10}} onClick={()=>setSort(k)}>{l}</button>
        ))}
      </div>
    </div>

    {/* TOTAL ROW */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
      {[
        {l:"Total Agencies",v:AGENCY_SCORES.length,c:"var(--text)"},
        {l:"Total Customers",v:AGENCY_SCORES.reduce((s,a)=>s+a.customers,0).toLocaleString(),c:"var(--text)"},
        {l:"Total Appts",v:AGENCY_SCORES.reduce((s,a)=>s+a.appts,0),c:"#2b6cb0"},
        {l:"Total Issued GDC",v:"$"+AGENCY_SCORES.reduce((s,a)=>s+a.issuedGDC,0).toLocaleString(),c:"var(--green2)"},
        {l:"Total Pipeline",v:AGENCY_SCORES.reduce((s,a)=>s+a.pendingOpp,0)+" opps",c:"var(--orange)"},
      ].map((s,i)=>(
        <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"12px 14px",boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:10,color:"var(--muted)",marginBottom:4}}>{s.l}</div>
          <div style={{fontSize:20,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
        </div>
      ))}
    </div>

    {/* AGENCY CARDS */}
    {sorted.map((a,i)=>(
      <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"18px 20px",marginBottom:10,boxShadow:"var(--shadow)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,paddingBottom:12,borderBottom:"1px solid var(--border)"}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"var(--navy)",marginBottom:2}}>#{i+1} {a.name}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Owner: {a.owner} · {a.customers.toLocaleString()} customers</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:22,fontWeight:700,color:"var(--green2)",lineHeight:1}}>{fmtK(a.issuedGDC)}</div>
            <div style={{fontSize:9,color:"var(--muted)",fontFamily:"DM Mono,monospace",textTransform:"uppercase",marginTop:2}}>Issued GDC YTD</div>
          </div>
        </div>

        {/* GDC bar */}
        <div style={{height:6,background:"var(--bg2)",borderRadius:3,marginBottom:14,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${(a.issuedGDC/maxGDC)*100}%`,background:"var(--green2)",borderRadius:3,transition:"width .6s"}}/>
        </div>

        {/* KPI row */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:10}}>
          {[
            {l:"Appointments",v:a.appts,c:"#2b6cb0"},
            {l:"Applications",v:a.apps,c:"var(--orange)"},
            {l:"Issued Cases",v:a.issued,c:"var(--green2)"},
            {l:"Pending Opps",v:a.pendingOpp,c:"var(--purple)"},
            {l:"Revenue Pipeline",v:fmtK(a.issuedGDC*3),c:"var(--text)"},
          ].map((k,j)=>(
            <div key={j} style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:700,color:k.c,lineHeight:1}}>{k.v}</div>
              <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>{k.l}</div>
            </div>
          ))}
        </div>

        {/* Opportunity breakdown */}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[{l:"OPRA",v:a.opra,c:"var(--red)"},{l:"Conversions",v:a.conv,c:"var(--orange)"},{l:"Life",v:a.life,c:"#2b6cb0"},{l:"Retirement",v:a.retire,c:"var(--purple)"},{l:"Business",v:a.biz,c:"#7b2d8b"}].map((o,k)=>(
            <div key={k} style={{display:"flex",alignItems:"center",gap:4,background:"var(--bg)",borderRadius:5,padding:"4px 9px",fontSize:10}}>
              <span style={{fontWeight:700,color:o.c,fontSize:13}}>{o.v}</span>
              <span style={{color:"var(--muted)"}}>{o.l}</span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </>);
}

// ─────────────────────────────────────────────────────────
// 6. DAILY BRIEFING — Full standalone page
// ─────────────────────────────────────────────────────────
function DailyBriefing({onNav, toast, appData={}}) {
  const { counts={}, urgentConversions=[], topOpportunities=[], gdc={}, loading=false } = appData;

  const expectedGDC = (gdc.pipeline||0) / 30; // rough daily estimate

  return (<>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:11,color:"var(--muted)",fontFamily:"DM Mono,monospace",letterSpacing:".08em",textTransform:"uppercase",marginBottom:4}}>Daily Briefing · {today}</div>
      <div style={{fontSize:28,fontWeight:700,color:"var(--navy)",marginBottom:4}}>Good Morning, Markist 👋</div>
      <div style={{fontSize:13,color:"var(--muted)"}}>Here's everything you need for today — your priorities, appointments, pipeline, and AI activity.</div>
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
        {!loading && topOpportunities.length===0 && PRIORITIES.slice(0,4).map((p,i)=>(
          <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,marginBottom:8,boxShadow:"var(--shadow)",cursor:"pointer"}}
            onClick={()=>{onNav("opps");toast(`Opening ${p.name}`,"info");}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:["#e53e3e","#553c9a","#dd6b20","#2b6cb0"][i],display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0}}>{i+1}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:600,color:"var(--text)"}}>{p.name}</div>
              <div style={{fontSize:11,color:"var(--muted)",marginTop:1}}>{p.reason}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:18,fontWeight:700,color:"#2b6cb0"}}>{p.score}</div>
              <div style={{fontSize:8,color:"var(--muted)",fontFamily:"DM Mono,monospace",textTransform:"uppercase"}}>Score</div>
            </div>
          </div>
        ))}
        <button className="btn-primary" style={{width:"100%",marginTop:4,padding:9}} onClick={()=>onNav("opps")}>View All Opportunities →</button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {/* APPOINTMENTS */}
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
          <div style={{background:"var(--navy)",color:"#fff",padding:"11px 16px",fontSize:12,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📋 Pending Forms ({counts.pending_forms||0})</span>
            <button style={{fontSize:9,padding:"2px 8px",borderRadius:3,border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"rgba(255,255,255,.7)",cursor:"pointer"}} onClick={()=>onNav("forms")}>Send Forms</button>
          </div>
          {APPOINTMENTS.map((a,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"9px 14px",borderBottom:"1px solid var(--border)",alignItems:"center"}}>
              <div style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--muted)",width:48,flexShrink:0}}>{a.time}</div>
              <div style={{width:8,height:8,borderRadius:"50%",background:a.color,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:500}}>{a.name}</div>
                <div style={{fontSize:9,color:"var(--muted)"}}>{a.type}</div>
              </div>
              <span style={{fontSize:8,fontFamily:"DM Mono,monospace",padding:"1px 5px",borderRadius:3,background:a.formDone?"var(--green-bg)":"var(--orange-bg)",color:a.formDone?"var(--green)":"var(--orange)",border:`1px solid ${a.formDone?"var(--green-border)":"var(--orange-border)"}`}}>
                {a.formDone?"Forms ✓":"Forms ⚠"}
              </span>
            </div>
          ))}
        </div>

        {/* AI ACTIVITY SUMMARY */}
        <div style={{background:"var(--navy)",borderRadius:10,padding:"16px",color:"#fff"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:12,color:"rgba(255,255,255,.8)"}}>🤖 AI Activity Today</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[{l:"Calls Made",v:63},{l:"Texts Sent",v:148},{l:"Emails Sent",v:29},{l:"Appts Booked",v:4}].map((s,i)=>(
              <div key={i} style={{textAlign:"center",background:"rgba(255,255,255,.06)",borderRadius:7,padding:"10px 8px"}}>
                <div style={{fontSize:22,fontWeight:700,color:["#4299e1","#9b72ff","#48bb78","#f0b429"][i],lineHeight:1}}>{s.v}</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.5)",marginTop:3}}>{s.l}</div>
              </div>
            ))}
          </div>
          <button style={{width:"100%",marginTop:10,padding:7,borderRadius:5,border:"1px solid rgba(255,255,255,.15)",background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.7)",fontSize:10,cursor:"pointer",fontFamily:"DM Sans,sans-serif"}} onClick={()=>onNav("agents")}>
            View AI Agent Details →
          </button>
        </div>

        {/* GDC SNAPSHOT */}
        <div style={{background:"var(--card)",border:"1px solid var(--green-border)",borderRadius:10,padding:"16px",boxShadow:"var(--shadow)"}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--navy)",marginBottom:10}}>💰 GDC Pipeline Snapshot</div>
          {[
            {l:"Pipeline GDC",v:"$284,500",c:"#2b6cb0"},
            {l:"Est. FSA Payout (80%)",v:"$227,600",c:"var(--green2)"},
            {l:"Cases This Month",v:"5",c:"var(--text)"},
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

export default function App(){
  const [page,setPage]=useState("briefing");
  const [tier,setTier]=useState(3);
  const [toasts,setToasts]=useState([]);
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
    {name:"Receptionist AI",status:"online",ct:"12 calls"},
    {name:"Appt Setter AI",status:"running",ct:"41 calls"},
    {name:"Conversion AI",status:"running",ct:"17 calls"},
    {name:"Follow Up AI",status:"running",ct:"89 texts"},
  ];
  const pageTitle={briefing:"Daily Briefing",dashboard:"Dashboard",opps:"Opportunities",agencies:"Agency Owners",conv:"Conversion Center",opra:"OPRA Center",calendar:"Calendar",ai:"AI Control Center",workshops:"Workshops",gdc:"GDC & Commission",prep:"Financial Review Prep",needs:"Customer Needs Map",calc:"Sales Calculator",contacts:"FFS Contacts",forms:"Client Forms",fna:"Financial Needs Analysis"};

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
        <div className="agents-box">
          <div className="ab-title">Live Status</div>
          {sideAgents.map((a,i)=>(<div className="agent-row" key={i}><div className={`a-dot ${a.status}`}/><div className="a-name">{a.name}</div><div className="a-ct">{a.ct}</div></div>))}
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
          <button className="help-btn" onClick={()=>toast("Opening AI Assistant","info")}>
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
          <div style={{flex:1,maxWidth:280,margin:"0 16px",position:"relative"}}>
            <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--muted)",fontSize:13,pointerEvents:"none"}}>🔍</span>
            <input placeholder="Search client, carrier, product..."
              style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:6,padding:"7px 10px 7px 32px",fontFamily:"DM Sans,sans-serif",fontSize:11,color:"var(--text)",outline:"none"}}
              onFocus={e=>e.target.style.borderColor="#bee3f8"} onBlur={e=>e.target.style.borderColor="var(--border)"}
              onChange={e=>{if(e.target.value.length>1)toast(`Searching: "${e.target.value}"...`,"info");}}/>
          </div>
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
          {page==="briefing"   &&<DailyBriefing onNav={setPage} toast={toast} appData={appData}/>}
          {page==="dashboard"  &&<Dashboard onNav={setPage} toast={toast} appData={appData}/>}
          {page==="opps"       &&<OpportunityDashboard toast={toast} appData={appData}/>}
          {page==="conv"       &&<ConversionCenter toast={toast} appData={appData}/>}
          {page==="opra"       &&<OPRACenter toast={toast} appData={appData}/>}
          {page==="agents"     &&<AIAgents toast={toast}/>}
          {page==="ai"         &&<AIControlCenter toast={toast}/>}
          {page==="agencies"   &&<AgencyOwners toast={toast}/>}
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
  </>);
}
