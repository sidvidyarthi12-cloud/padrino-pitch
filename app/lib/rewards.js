// Which card to pay a vendor with. Pure functions, no DOM, no network.
// Rewards are an estimate from the rate the couple typed in for each card. Nothing here is a promise from a card company.
//
// rewardsForPayment(amount, cards, { surchargePct }) =>
//   { amount, surchargePct,
//     options: [{ cardId, name, mask, rewardPct, known, charged, surcharge, rewards, net, fits, available, balance,
//                 interestPerMonth, monthsToWipeOut, best }],   best net first, cards with no rate last
//     best: option | null,       the card to use, only when it comes out ahead
//     worthIt: boolean,
//     advice: 'card' | 'bank' | 'set_rate' | 'none',
//     text: one plain sentence,
//     warning: the pay-in-full note (empty when advice is not 'card'),
//     bankText: what paying from the bank looks like }
//
// cards come from the store's getCards(): [{ id, name, mask, balance, available, rewardPct, apr? }]
// rewardPct and surchargePct are percents: 2 means 2%.
// charged = amount plus the vendor's surcharge. rewards = charged x rate. net = rewards minus the surcharge.

import { formatMoney } from "./money.js";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const cents = (n) => Math.round(n * 100) / 100;
const usd = (n) => formatMoney(n, { cents: !Number.isInteger(cents(n)) });

// The card fee a quote lists, as a percent, or null. Looks at charges whose label talks about cards.
export function surchargeFromQuote(decoded) {
  const charges = Array.isArray(decoded?.charges) ? decoded.charges : [];
  for (const c of charges) {
    if (!/\b(credit|card|processing|convenience|surcharge)\b/i.test(String(c?.label || ""))) continue;
    if (isNum(c.rate) && c.rate > 0) return cents(c.rate <= 1 ? c.rate * 100 : c.rate);
  }
  return null;
}

export function rewardsForPayment(amount, cards, { surchargePct = 0 } = {}) {
  const base = isNum(Number(amount)) && Number(amount) > 0 ? cents(Number(amount)) : 0;
  const sur = isNum(Number(surchargePct)) && Number(surchargePct) > 0 ? Number(surchargePct) : 0;
  const charged = cents(base * (1 + sur / 100));
  const surcharge = cents(charged - base);
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && c.id);

  const options = list.map((c) => {
    const known = isNum(c.rewardPct) && c.rewardPct >= 0;
    const rewards = known ? cents((charged * c.rewardPct) / 100) : null;
    const available = isNum(c.available) ? c.available : null;
    const apr = isNum(c.apr) && c.apr > 0 ? c.apr : null;
    // One month of interest on this payment alone, if the card is not paid off.
    const interestPerMonth = apr ? cents((charged * apr) / 100 / 12) : null;
    return {
      cardId: c.id,
      name: c.name || "Card",
      mask: c.mask || null,
      rewardPct: known ? c.rewardPct : null,
      known,
      charged,
      surcharge,
      rewards,
      net: known ? cents(rewards - surcharge) : null,
      fits: available === null ? true : charged <= available,
      available,
      balance: isNum(c.balance) ? c.balance : null,
      interestPerMonth,
      monthsToWipeOut: known && interestPerMonth && rewards > 0 ? Math.round((rewards / interestPerMonth) * 10) / 10 : null,
      best: false,
    };
  });
  options.sort((a, b) => (a.known === b.known ? (b.net ?? 0) - (a.net ?? 0) : a.known ? -1 : 1));

  const top = options.find((o) => o.known && o.fits);
  const best = top && top.net > 0 ? top : null;
  if (best) best.best = true;

  const bankText = "Paying from your bank costs nothing extra and earns nothing. A Zelle, check or bank transfer has no card fee.";
  let advice = "none";
  let text = "";
  let warning = "";

  if (!options.length) {
    text = "No card is connected, so pay from your bank.";
  } else if (!options.some((o) => o.known)) {
    advice = "set_rate";
    text = "Tell us your card's rewards rate and we will check if it beats paying from your bank.";
  } else if (best) {
    advice = "card";
    const who = `${best.name}${best.mask ? ` ending ${best.mask}` : ""}`;
    text = sur
      ? `Use your ${who}. You earn about ${usd(best.rewards)} back and the vendor's ${sur}% card fee costs ${usd(surcharge)}, so you come out ${usd(best.net)} ahead.`
      : `Use your ${who} and earn about ${usd(best.rewards)} back.`;
    const owed = best.balance && best.balance > 0 ? ` It has ${usd(best.balance)} on it now.` : "";
    warning = best.monthsToWipeOut
      ? `Pay the card off in full this month.${owed} Carrying it costs about ${usd(best.interestPerMonth)} a month in interest, which cancels the ${usd(best.rewards)} ${best.monthsToWipeOut <= 1 ? "in about a month" : `in about ${best.monthsToWipeOut} months`}.`
      : `Pay the card off in full this month.${owed} If you carry a balance, the interest costs more than the rewards pay.`;
  } else {
    advice = "bank";
    const blocked = options.find((o) => o.known && !o.fits);
    if (top === undefined && blocked) {
      text = `${blocked.name} does not have enough room for ${usd(charged)}. Pay from your bank.`;
    } else if (sur && top && top.rewards > 0) {
      text = `Skip the card. The vendor's ${sur}% fee (${usd(surcharge)}) costs more than the ${usd(top.rewards)} you would earn. Pay from your bank.`;
    } else {
      text = "No card beats paying from your bank for this one. Pay from your bank.";
    }
  }

  return { amount: base, surchargePct: sur, options, best, worthIt: Boolean(best), advice, text, warning, bankText };
}
