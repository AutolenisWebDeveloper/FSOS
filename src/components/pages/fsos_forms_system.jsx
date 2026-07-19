import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────
// FSOS FORMS SYSTEM — Command Center Page
// Covers:
// - Forms library (7 blank forms)
// - Send form links to clients (manual + auto)
// - View submitted responses per client
// - Financial Needs Analysis generator (Claude API)
// - Supabase schema reference
// ─────────────────────────────────────────────────────────

const G = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
:root {
  --navy:#0f1e36;--bg:#f4f6f9;--bg2:#edf0f4;--card:#fff;
  --border:#e4e8ef;--text:#1a2332;--muted:#6b7a8d;--dim:#a8b4c0;
  --red:#e53e3e;--red-bg:#fff5f5;--red-border:#fed7d7;
  --orange:#dd6b20;--orange-bg:#fffaf0;--orange-border:#fbd38d;
  --green:#276749;--green2:#38a169;--green-bg:#f0fff4;--green-border:#9ae6b4;
  --blue:#2b6cb0;--blue-bg:#ebf8ff;--blue-border:#bee3f8;
  --purple:#553c9a;--purple-bg:#faf5ff;--purple-border:#d6bcfa;
  --gold:#b7791f;--gold-bg:#fffff0;--gold-border:#f6e05e;
  --shadow:0 1px 3px rgba(0,0,0,.08);--shadow2:0 4px 16px rgba(0,0,0,.12);
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;line-height:1.5;}

.page-title{font-size:20px;font-weight:600;color:var(--text);margin-bottom:4px;}
.page-sub{font-size:12px;color:var(--muted);margin-bottom:20px;}

/* TABS */
.tab-bar{display:flex;gap:2px;margin-bottom:20px;background:var(--bg2);border-radius:8px;padding:4px;}
.tab-btn{flex:1;padding:8px 12px;border:none;background:transparent;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;color:var(--muted);cursor:pointer;transition:all .15s;text-align:center;}
.tab-btn.active{background:var(--card);color:var(--text);box-shadow:var(--shadow);}

/* FORM CARDS */
.forms-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}
.form-card{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:var(--shadow);transition:box-shadow .2s;}
.form-card:hover{box-shadow:var(--shadow2);}
.form-card-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px;}
.form-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.form-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;}
.form-id{font-size:9px;color:var(--muted);font-family:'DM Mono',monospace;}
.form-card-body{padding:12px 16px;}
.form-desc{font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:10px;}
.form-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}
.fm-tag{font-size:9px;font-family:'DM Mono',monospace;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em;}
.form-actions{display:flex;gap:6px;}
.btn-primary{padding:7px 14px;border-radius:5px;border:none;background:#2b6cb0;color:#fff;font-size:11px;font-family:'DM Sans',sans-serif;font-weight:500;cursor:pointer;transition:background .15s;white-space:nowrap;}
.btn-primary:hover{background:#2c5282;}
.btn-secondary{padding:7px 14px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn-secondary:hover{border-color:#bee3f8;color:var(--blue);}
.btn-green{padding:7px 14px;border-radius:5px;border:none;background:var(--green2);color:#fff;font-size:11px;font-family:'DM Sans',sans-serif;font-weight:500;cursor:pointer;transition:background .15s;}
.btn-green:hover{background:var(--green);}
.btn-gold{padding:7px 14px;border-radius:5px;border:none;background:#b7791f;color:#fff;font-size:11px;font-family:'DM Sans',sans-serif;font-weight:500;cursor:pointer;}

/* RESPONSES TABLE */
.resp-table{width:100%;border-collapse:collapse;}
.resp-table th{text-align:left;padding:8px 12px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);background:var(--bg2);}
.resp-table td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;vertical-align:middle;}
.resp-table tr:last-child td{border-bottom:none;}
.resp-table tr:hover td{background:var(--bg2);}
.status-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;}
.status-dot.complete{background:var(--green2);}
.status-dot.pending{background:var(--orange);}
.status-dot.sent{background:#4299e1;}

/* SEND MODAL */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center;}
.modal-overlay.open{display:flex;}
.modal{background:var(--card);border-radius:12px;padding:24px;width:520px;max-width:95vw;box-shadow:var(--shadow2);}
.modal-title{font-size:16px;font-weight:600;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);}
.field{margin-bottom:12px;}
.field label{display:block;font-size:10px;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;}
.field input,.field select,.field textarea{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:8px 10px;font-family:'DM Sans',sans-serif;font-size:12px;color:var(--text);outline:none;transition:border-color .15s;}
.field input:focus,.field select:focus{border-color:#bee3f8;}
.field select option{background:var(--card);}
.link-preview{background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:8px 12px;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;}
.copy-btn{font-size:10px;padding:3px 8px;border-radius:3px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;}
.copy-btn:hover{border-color:#bee3f8;color:var(--blue);}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;}

/* FNA */
.fna-wrap{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.fna-left{display:flex;flex-direction:column;gap:12px;}
.fna-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;box-shadow:var(--shadow);}
.fna-card-title{font-size:13px;font-weight:600;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px;}
.fna-report{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;box-shadow:var(--shadow);}
.report-header{border-bottom:2px solid var(--navy);padding-bottom:14px;margin-bottom:16px;}
.report-title{font-size:20px;font-weight:700;color:var(--navy);}
.report-sub{font-size:11px;color:var(--muted);margin-top:3px;}
.report-section{margin-bottom:18px;}
.rs-title{font-size:12px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--border);}
.rs-content{font-size:12px;color:var(--text);line-height:1.8;}
.rs-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}
.rs-item{background:var(--bg);border-radius:5px;padding:8px 10px;}
.rs-item-label{font-size:9px;color:var(--muted);font-family:'DM Mono',monospace;text-transform:uppercase;margin-bottom:2px;}
.rs-item-val{font-size:13px;font-weight:600;color:var(--text);}
.priority-rec{background:var(--blue-bg);border:1px solid var(--blue-border);border-radius:7px;padding:12px 14px;margin-bottom:8px;}
.pr-num{font-size:10px;font-family:'DM Mono',monospace;color:var(--blue);font-weight:600;margin-bottom:3px;}
.pr-title{font-size:13px;font-weight:600;color:var(--navy);margin-bottom:3px;}
.pr-body{font-size:11px;color:var(--muted);line-height:1.6;}
.disclaimer{font-size:9px;color:var(--dim);line-height:1.5;padding:10px 12px;border:1px solid var(--border);border-radius:5px;margin-top:16px;}
.loading-state{text-align:center;padding:40px 20px;}
.loading-spinner{width:32px;height:32px;border:3px solid var(--border);border-top-color:#2b6cb0;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;}
@keyframes spin{to{transform:rotate(360deg)}}

/* TOAST */
.toast-wrap{position:fixed;bottom:18px;right:18px;z-index:999;display:flex;flex-direction:column;gap:7px;}
.toast{background:var(--navy);color:#fff;border-radius:7px;padding:9px 14px;font-size:11px;display:flex;align-items:center;gap:7px;min-width:220px;box-shadow:var(--shadow2);animation:toastIn .2s ease;}
@keyframes toastIn{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
.toast.success{border-left:3px solid #48bb78;}.toast.error{border-left:3px solid #e53e3e;}.toast.info{border-left:3px solid #4299e1;}

@media(max-width:700px){.fna-wrap{grid-template-columns:1fr;}.forms-grid{grid-template-columns:1fr;}.rs-grid{grid-template-columns:1fr;}}
`;

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
  const BASE = "https://fsos.vercel.app/forms";
  const link = `${BASE}/${form?.id}?client=${encodeURIComponent(client)}&t=${Date.now()}`;

  const send = () => {
    if(!client) { toast("Client name is required", "error"); return; }
    if(channel === "email" && !email) { toast("Email is required", "error"); return; }
    toast(`✓ Form link sent to ${client} via ${channel}`, "success");
    onClose();
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
            <label>Generated Link</label>
            <div className="link-preview">
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{link}</span>
              <button className="copy-btn" onClick={() => { navigator.clipboard?.writeText(link); toast("Link copied!", "success"); }}>Copy</button>
            </div>
            <div style={{fontSize:10, color:"var(--muted)", marginTop:5}}>Link expires in 30 days. Client fills out the form and submits — response is automatically stored and linked to their record in Supabase.</div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={send}>Send Form →</button>
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

  const responses = MOCK_RESPONSES.filter(r => r.form_id === "financial-needs-analysis" || r.form_id === "customer-profile");

  const generateReport = async () => {
    const resp = MOCK_RESPONSES.find(r => r.id === selected);
    if(!resp) { toast("Select a client first", "error"); return; }
    setLoading(true);
    setReport(null);

    try {
      const prompt = `You are a financial advisor at Farmers Financial Solutions, LLC. Generate a professional Financial Needs Analysis report for the following client. Use a warm but professional tone. Structure the report exactly as specified.

CLIENT DATA:
${JSON.stringify(resp.data, null, 2)}

Generate a complete Financial Needs Analysis with these exact sections:
1. EXECUTIVE SUMMARY (2-3 sentences summarizing the client's financial situation and primary needs)
2. CURRENT FINANCIAL POSITION (assess their income, savings, assets, debts, and coverage)
3. IDENTIFIED GAPS & OPPORTUNITIES (specific gaps in life insurance, retirement, savings, or estate planning)
4. RECOMMENDATIONS (3-5 prioritized recommendations based on FFS products and the client's age/risk profile)
5. NEXT STEPS (specific action items for the FSA meeting)

IMPORTANT COMPLIANCE NOTE: All recommendations are educational and informational only. No specific product is being recommended. Any product discussion requires a licensed FSA meeting, suitability review, and compliance with FINRA Reg BI.

Respond in JSON format:
{
  "executive_summary": "string",
  "financial_position": "string",
  "gaps": ["gap1", "gap2", "gap3"],
  "recommendations": [{"priority": 1, "title": "string", "description": "string", "product_category": "string"}],
  "next_steps": ["step1", "step2", "step3"],
  "risk_profile": "string",
  "urgency": "High|Medium|Low"
}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setReport({ client: resp.client, data: resp.data, analysis: parsed, generated_at: new Date().toLocaleDateString("en-US", {year:"numeric",month:"long",day:"numeric"}) });
      toast("✓ FNA report generated successfully", "success");
    } catch(e) {
      // Fallback mock for demo
      setReport({
        client: resp.client,
        data: resp.data,
        analysis: {
          executive_summary: `${resp.data.first_name} ${resp.data.last_name||""} presents a solid foundation with an annual household income of ${fmt(resp.data.annual_income)}, but faces meaningful gaps in life insurance coverage and retirement income planning that warrant immediate attention in their upcoming FSA review.`,
          financial_position: `Client has an estimated net worth of ${fmt(resp.data.net_worth||0)} with a self-described ${resp.data.risk_tolerance||"moderate"} risk tolerance and a ${resp.data.investment_horizon||"10-20 year"} investment horizon. Existing retirement assets and life coverage leave identifiable gaps relative to their stated goals.`,
          gaps: [
            "Life insurance coverage below 10x annual income — protection gap exists",
            "No IRA or Roth IRA identified — tax diversification opportunity",
            "Retirement income goal vs. projected Social Security leaves a significant monthly shortfall",
            "No mention of emergency fund meeting 3-6 month threshold",
            "Estate planning documents not confirmed current"
          ],
          recommendations: [
            {priority:1, title:"Life Insurance Gap Analysis", description:"Current coverage requires review against the 10x income benchmark and total household liability exposure. A term or permanent solution may be appropriate depending on suitability.", product_category:"Life Insurance"},
            {priority:2, title:"Retirement Income Planning", description:"Gap between retirement income goal and projected Social Security creates a fixed-income shortfall opportunity. Tax-deferred and indexed annuity options may align with stated risk tolerance.", product_category:"Annuities / Retirement"},
            {priority:3, title:"IRA / Roth IRA Contribution Review", description:"No IRA on record. Age and income profile suggests IRA or Roth IRA contributions could provide tax diversification and additional retirement savings vehicle.", product_category:"Mutual Funds / IRA"},
            {priority:4, title:"Emergency Fund Assessment", description:"Confirm liquid reserve status. If below 3-6 months of expenses, a money market or short-term savings strategy should be established before investment allocation.", product_category:"Savings"},
          ],
          next_steps: [
            "Schedule financial review appointment to present FNA findings",
            "Complete Liability Exposure Worksheet before meeting",
            "Call FFS Sales Desk (866) 888-9739 Opt 3→3 to review case before presentation",
            "Prepare life insurance illustration through FFS",
            "Confirm suitability profile with Customer Profile Worksheet"
          ],
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
                {responses.map(r => <option key={r.id} value={r.id}>{r.client} — {r.form_id.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase())} ({r.submitted_at})</option>)}
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

  const filtered = filter === "all" ? MOCK_RESPONSES : MOCK_RESPONSES.filter(r => r.form_id === filter);
  const selectedResp = MOCK_RESPONSES.find(r => r.id === selected);

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <div>
        <div style={{marginBottom:10}}>
          <select style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:5,padding:"6px 10px",fontSize:11,fontFamily:"DM Mono, monospace",color:"var(--text)"}} value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All Forms</option>
            {FORMS.map(f=><option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
        </div>
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",boxShadow:"var(--shadow)"}}>
          <table className="resp-table">
            <thead><tr><th>Client</th><th>Form</th><th>Submitted</th><th>Status</th></tr></thead>
            <tbody>{filtered.map(r=>(
              <tr key={r.id} style={{cursor:"pointer",background:selected===r.id?"var(--blue-bg)":"transparent"}} onClick={()=>setSelected(r.id)}>
                <td style={{fontWeight:500}}>{r.client}</td>
                <td style={{fontSize:10,color:"var(--muted)"}}>{FORMS.find(f=>f.id===r.form_id)?.title||r.form_id}</td>
                <td style={{fontFamily:"DM Mono,monospace",fontSize:10,color:"var(--muted)"}}>{r.submitted_at}</td>
                <td><span className="status-dot complete"/><span style={{fontSize:10}}>Complete</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div>
        {selectedResp ? (
          <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:16,boxShadow:"var(--shadow)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>{selectedResp.client}</div>
                <div style={{fontSize:10,color:"var(--muted)",fontFamily:"DM Mono,monospace"}}>{FORMS.find(f=>f.id===selectedResp.form_id)?.title} · {selectedResp.submitted_at}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button className="btn-secondary" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>toast("Printing form","info")}>Print</button>
                {selectedResp.form_id==="financial-needs-analysis"&&<button className="btn-gold" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>toast("Generating FNA","info")}>Generate FNA</button>}
              </div>
            </div>
            <div style={{maxHeight:400,overflowY:"auto"}}>
              {Object.entries(selectedResp.data).map(([k,v])=>(
                <div key={k} style={{display:"grid",gridTemplateColumns:"140px 1fr",gap:8,padding:"5px 0",borderBottom:"1px solid var(--border)",fontSize:11}}>
                  <div style={{color:"var(--muted)",fontFamily:"DM Mono,monospace",fontSize:9,textTransform:"uppercase",letterSpacing:".05em",paddingTop:1}}>{k.replace(/_/g," ")}</div>
                  <div style={{color:"var(--text)",lineHeight:1.4}}>{Array.isArray(v)?v.join(", "):String(v)}</div>
                </div>
              ))}
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
export default function FormsSystem() {
  const [activeTab, setActiveTab] = useState("library");
  const [sendModal, setSendModal] = useState(null);
  const {toasts, add: toast} = useToasts();

  const tabs = [
    {id:"library", label:"📋 Forms Library"},
    {id:"responses", label:"📥 Submitted Responses"},
    {id:"fna", label:"✦ FNA Generator"},
    {id:"schema", label:"🗄 Supabase Schema"},
  ];

  return (
    <>
      <style>{G}</style>
      <div style={{maxWidth:1200,margin:"0 auto",padding:"20px 24px 60px"}}>
        <div className="page-title">Forms & Financial Needs Analysis</div>
        <div className="page-sub">Send digital forms to clients · Receive and store responses in Supabase · Generate AI-powered FNA reports · All linked to each client record</div>

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
                  <div className="form-actions">
                    <button className="btn-primary" onClick={() => setSendModal(f)}>Send to Client</button>
                    <button className="btn-secondary" onClick={() => window.open(`#/forms/${f.id}`,"_blank")}>Preview</button>
                    {f.id === "financial-needs-analysis" && <button className="btn-gold" onClick={() => setActiveTab("fna")}>Generate FNA</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* RESPONSES */}
        {activeTab === "responses" && <ResponsesViewer toast={toast}/>}

        {/* FNA GENERATOR */}
        {activeTab === "fna" && <FNAGenerator toast={toast}/>}

        {/* SCHEMA */}
        {activeTab === "schema" && <SchemaView/>}

        <SendModal form={sendModal} onClose={() => setSendModal(null)} toast={toast}/>
      </div>

      <div className="toast-wrap">
        {toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </>
  );
}
