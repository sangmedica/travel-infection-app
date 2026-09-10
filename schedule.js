// 出発前の予防接種タイミングを逆算する決定論的エンジン。
// ブラウザ（app.js から import）と Node（scripts/schedule.test.mjs）の両方から使う。
// 臨床意思決定支援・教育目的。回数・間隔・迅速化・禁忌・小児量は必ず一次資料で確認すること。

export const DAY_MS = 86400000;

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}
export function addDays(iso, n) {
  return new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);
}
export function describeOffsets(offs) {
  return offs.join("・") + "日";
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** 推奨ワクチン名（英語）をスケジュール表の項目に照合する */
export function matchSchedule(nameEn, schedules) {
  const rn = norm(nameEn);
  if (!rn) return null;
  for (const v of schedules.vaccines || []) {
    const names = [v.name_en, ...(v.match_en || [])].map(norm).filter(Boolean);
    if (names.some((n) => n === rn || rn.includes(n) || n.includes(rn))) return v;
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.today             ISO 日付（例: "2026-09-10"）
 * @param {string} opts.departureDate     ISO 日付
 * @param {string} [opts.firstVisitDate]  初回に接種を受けられる日（ISO）。未指定なら today。
 *        過去日は today として扱う。ここを起点にタイムラインを引く。
 * @param {Array<{name_en:string, name_ja?:string, category?:string}>} opts.recommended
 *        接種を希望するワクチン（渡航先の推奨から利用者が選択したもの）
 * @param {boolean} opts.accelerated      迅速化スケジュールを優先
 * @param {{vaccines:Array}} opts.schedules   data/kb/vaccine-schedules.json
 * @param {boolean} opts.malaria          渡航先にマラリア予防内服の推奨があるか
 * @returns {{items:Array, leadItems:Array, warnings:string[], daysToDeparture:number|null,
 *           matched:number, start:string, firstVisit:string|null, visitDates:string[]}}
 */
export function buildSchedule(opts) {
  const {
    today,
    departureDate,
    firstVisitDate = null,
    recommended = [],
    accelerated = false,
    schedules = { vaccines: [] },
    malaria = false,
  } = opts || {};

  const warnings = [];
  const items = [];
  const leadItems = [];

  const dtd = departureDate ? daysBetween(today, departureDate) : null;
  if (dtd == null || Number.isNaN(dtd)) {
    return {
      items: [],
      leadItems: [],
      warnings: ["渡航予定日を入力してください。"],
      daysToDeparture: null,
      matched: 0,
      start: today,
      firstVisit: null,
      visitDates: [],
    };
  }
  if (dtd < 0) warnings.push("渡航予定日が過去の日付です。");

  // 起点＝初回に接種を受けられる日（未指定・過去なら今日）
  let start = today;
  let firstVisit = null;
  if (firstVisitDate) {
    const fv = daysBetween(today, firstVisitDate);
    if (!Number.isNaN(fv) && fv > 0) {
      start = firstVisitDate;
      firstVisit = firstVisitDate;
      if (daysBetween(firstVisitDate, departureDate) < 0)
        warnings.push("初回に接種を受けられる日が渡航予定日より後です。日程を見直してください。");
    }
  }

  const used = new Set();
  let matched = 0;

  for (const rec of recommended) {
    const sched = matchSchedule(rec.name_en, schedules);
    if (!sched || used.has(sched.id)) continue;
    used.add(sched.id);
    matched++;

    const useAccel = accelerated && Array.isArray(sched.accelerated_days);
    const offsets = useAccel ? sched.accelerated_days : sched.schedule_days;
    const lead = sched.last_dose_lead_days || 0;
    const total = offsets.length;

    const mine = [];
    offsets.forEach((off, i) => {
      const date = addDays(start, off);
      const dFromToday = daysBetween(today, date);
      const dFromDep = daysBetween(date, departureDate);
      let status = "ok";
      if (dFromToday < 0) status = "past";
      else if (dFromDep < 0) status = "after";
      else if (dFromDep < lead) status = "tight";
      const it = {
        date,
        dayFromToday: dFromToday,
        dayFromDeparture: dFromDep,
        vaccineId: sched.id,
        name_ja: sched.name_ja,
        name_en: sched.name_en,
        live: !!sched.live,
        doseNo: i + 1,
        doseTotal: total,
        accelerated: useAccel,
        category: rec.category || null,
        status,
        source_ja: rec.source === "thp" ? "TravelHealthPro" : rec.source === "forth" ? "FORTH" : "CDC",
      };
      items.push(it);
      mine.push(it);
    });

    const beforeDeparture = mine.filter((it) => it.status !== "after").length;
    const lastFit = mine[mine.length - 1].status !== "after";
    const slack = daysBetween(mine[mine.length - 1].date, departureDate);

    if (beforeDeparture === 0) {
      warnings.push(
        `${sched.name_ja}：出発までにこのワクチンを接種する余裕がありません。防御が得られない可能性が高いため、日程調整・代替策を渡航医と相談してください。`
      );
    } else if (!lastFit || beforeDeparture < total) {
      if (Array.isArray(sched.accelerated_days) && !useAccel) {
        warnings.push(
          `${sched.name_ja}：標準スケジュール（${describeOffsets(sched.schedule_days)}）では出発までに全${total}回を完了できません。迅速化スケジュール（${describeOffsets(
            sched.accelerated_days
          )}）で間に合うか確認してください。`
        );
      } else if (sched.single_dose_useful) {
        leadItems.push({
          vaccineId: sched.id,
          name_ja: sched.name_ja,
          text_ja: `出発前に接種できるのは${total}回中${beforeDeparture}回です。まず接種すれば部分的な効果は期待できます。残りは帰国後に完了してください。`,
        });
      } else {
        warnings.push(
          `${sched.name_ja}：出発までに必要な全${total}回を完了できません（1回のみでは防御不十分）。日程調整を検討してください。`
        );
      }
    } else if (slack >= 0 && slack < lead) {
      warnings.push(
        `${sched.name_ja}：最終回から出発まで${slack}日しかありません（推奨は${lead}日以上）。免疫が十分立ち上がらない、または証明書が有効化しない可能性があります。`
      );
    }

    if (sched.id === "yellow_fever") {
      leadItems.push({
        vaccineId: "yellow_fever",
        name_ja: "黄熱",
        text_ja: "国際予防接種証明書は接種の10日後から有効。日本では検疫所・一部の指定医療機関でのみ接種可（予約制のため早めに手配）。",
      });
    }
  }

  const liveDates = new Set(items.filter((it) => it.live && it.status !== "after").map((it) => it.date));
  if (liveDates.size > 1) {
    leadItems.push({
      vaccineId: "_live",
      name_ja: "生ワクチン",
      text_ja: "複数の生ワクチン（黄熱・MMR・水痘など）は同日に接種するか、4週間以上あけて接種します。",
    });
  }

  if (malaria) {
    leadItems.push({
      vaccineId: "_malaria",
      name_ja: "マラリア予防内服",
      text_ja:
        "渡航先にマラリア予防内服の推奨があります。開始時期は薬剤で異なります（アトバコン・プログアニル／ドキシサイクリンは1〜2日前、メフロキンは2〜3週間前、クロロキンは1〜2週間前、タフェノキンは3日前から負荷投与）。詳細は「マラリア予防」を参照。",
    });
  }

  const windowDays = firstVisit ? daysBetween(firstVisit, departureDate) : dtd;
  if (windowDays >= 0 && windowDays < 14 && matched > 0) {
    warnings.push(
      firstVisit
        ? `初回に接種を受けられる日から出発まで${windowDays}日です。多くのワクチンは効果発現まで1〜2週間かかります。受診日を前倒しできないか、渡航医療機関にご相談ください。`
        : `出発まで${dtd}日です。多くのワクチンは効果発現まで1〜2週間かかります。渡航医療機関に至急ご相談ください。`
    );
  }
  if (matched === 0) {
    warnings.push(
      "この渡航先では、スケジュール表に対応する渡航ワクチンの推奨が見つかりませんでした。定期接種（麻疹・破傷風など）の最新化は別途ご確認ください。"
    );
  }

  items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.name_ja.localeCompare(b.name_ja, "ja") ||
      a.doseNo - b.doseNo
  );
  const visitDates = [
    ...new Set(items.filter((it) => it.status !== "after").map((it) => it.date)),
  ].sort();
  return { items, leadItems, warnings, daysToDeparture: dtd, matched, start, firstVisit, visitDates };
}
